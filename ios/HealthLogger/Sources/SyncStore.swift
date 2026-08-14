import Foundation
import Security

// Settings, anchors and sync status. The bearer token lives in the Keychain; anchors
// live in a JSON file in Application Support (they are opaque blobs, not secrets, and
// a file survives the UserDefaults size pressure years of types would create).

@MainActor
final class SyncStore: ObservableObject {
    static let shared = SyncStore()

    // MARK: Published UI state
    @Published var token: String { didSet { Keychain.set(token, for: "fuel-sync-token") } }
    @Published var endpoint: String { didSet { defaults.set(endpoint, forKey: "endpoint") } }
    @Published var lastSyncAt: Date? { didSet { defaults.set(lastSyncAt, forKey: "lastSyncAt") } }
    @Published var lastSyncSummary: String { didSet { defaults.set(lastSyncSummary, forKey: "lastSyncSummary") } }
    @Published var initialSyncComplete: Bool { didSet { defaults.set(initialSyncComplete, forKey: "initialSyncComplete") } }
    @Published var status: SyncStatus = .idle
    /// 0…1 while a sync runs, back to 0 when it ends. Drives the bar across the top of
    /// the app. Not persisted — a fraction from a previous launch means nothing.
    @Published var syncProgress: Double = 0

    // MARK: What syncs, and when
    //
    // Coarse, on purpose: these gate the three drain loops SyncEngine.run() already has
    // (quantity samples, category samples, workouts) plus the one clearly more sensitive
    // sub-piece of a workout, its GPS route — rather than a per-HealthKit-type picker,
    // which would need touching the anchored drain loop itself for every one of ~30
    // types. All default true, so a fresh install behaves exactly as before this existed.
    @Published var syncQuantitySamples: Bool { didSet { defaults.set(syncQuantitySamples, forKey: "syncQuantitySamples") } }
    @Published var syncCategorySamples: Bool { didSet { defaults.set(syncCategorySamples, forKey: "syncCategorySamples") } }
    @Published var syncWorkouts: Bool { didSet { defaults.set(syncWorkouts, forKey: "syncWorkouts") } }
    @Published var syncWorkoutRoutes: Bool { didSet { defaults.set(syncWorkoutRoutes, forKey: "syncWorkoutRoutes") } }
    /// When off, no HKObserverQuery or BGTask is registered — sync only ever runs while
    /// the app is open (a manual pull-to-refresh, or on launch/foreground).
    @Published var backgroundSyncEnabled: Bool { didSet { defaults.set(backgroundSyncEnabled, forKey: "backgroundSyncEnabled") } }

    // MARK: When a sync is allowed to run
    //
    // Background sync used to be one switch: on meant "whenever iOS offers", off meant
    // "only while I am looking at it". These break that into the three things that
    // actually differ — how often at most, whether Health waking the app counts, and
    // whether a finished workout counts — because they have genuinely different costs.
    // A workout ending is worth an immediate sync; an idle Tuesday afternoon is not.

    /// The shortest gap between background syncs, in minutes. A sync asked for sooner
    /// than this is skipped rather than queued: the next opportunity will cover the same
    /// ground, since every sync re-reads the last three days regardless.
    @Published var minimumSyncInterval: Int { didSet { defaults.set(minimumSyncInterval, forKey: "minimumSyncInterval") } }
    /// Let Health wake the app when it records something new.
    @Published var syncOnHealthUpdate: Bool { didSet { defaults.set(syncOnHealthUpdate, forKey: "syncOnHealthUpdate") } }
    /// Sync as soon as a workout finishes, ignoring the interval above — this is the one
    /// moment where waiting means looking at a dashboard that is visibly wrong.
    @Published var syncAfterWorkout: Bool { didSet { defaults.set(syncAfterWorkout, forKey: "syncAfterWorkout") } }
    /// A daily catch-up at a time of your choosing, stored as minutes from midnight.
    @Published var dailySyncEnabled: Bool { didSet { defaults.set(dailySyncEnabled, forKey: "dailySyncEnabled") } }
    @Published var dailySyncMinute: Int { didSet { defaults.set(dailySyncMinute, forKey: "dailySyncMinute") } }
    /// When the last background sync actually ran, for the interval check.
    @Published var lastBackgroundSyncAt: Date? { didSet { defaults.set(lastBackgroundSyncAt, forKey: "lastBackgroundSyncAt") } }
    /// The set of Health types this device has actually been asked about. Compared with
    /// HealthKitCatalog.readTypesSignature so a build that added metrics asks again.
    @Published var authorizedTypesSignature: String { didSet { defaults.set(authorizedTypesSignature, forKey: "authorizedTypesSignature") } }

    /// Whether a background sync may run now. Anything the person did by hand — opening
    /// the app, pulling to refresh — bypasses this entirely; it only governs the
    /// automatic ones.
    func maySyncInBackground(reason: String, now: Date = Date()) -> Bool {
        guard backgroundSyncEnabled else { return false }
        if reason.contains("workout") { return syncAfterWorkout }
        if reason.contains("health update") && !syncOnHealthUpdate { return false }
        guard let last = lastBackgroundSyncAt else { return true }
        return now.timeIntervalSince(last) >= Double(minimumSyncInterval) * 60
    }

    enum SyncStatus: Equatable {
        case idle
        case running(String)          // human-readable stage, e.g. "Uploading heart rate (12,400)…"
        case failed(String)
    }

    private let defaults = UserDefaults.standard

    /// The one-tap default. Anything else is a custom destination that must speak the
    /// same /api/health/sync/v1 protocol — see HEALTH_SYNC.md for the contract.
    static let fuelEndpoint = "https://fuel.rishib.com/api/health/sync/v1"

    /// Remembered separately from `endpoint`, so switching to Fuel and back does not
    /// make the user retype their own server's URL.
    @Published var customEndpoint: String { didSet { defaults.set(customEndpoint, forKey: "customEndpoint") } }

    var isFuelDestination: Bool { endpoint == Self.fuelEndpoint }

    func useFuel() { endpoint = Self.fuelEndpoint }
    func useCustom() { endpoint = customEndpoint }

    private init() {
        token = Keychain.get("fuel-sync-token") ?? ""
        customEndpoint = defaults.string(forKey: "customEndpoint") ?? ""
        endpoint = defaults.string(forKey: "endpoint") ?? Self.fuelEndpoint
        lastSyncAt = defaults.object(forKey: "lastSyncAt") as? Date
        lastSyncSummary = defaults.string(forKey: "lastSyncSummary") ?? ""
        initialSyncComplete = defaults.bool(forKey: "initialSyncComplete")
        // object(forKey:) rather than bool(forKey:): a key that was never set must read
        // as true (existing behavior), which bool(forKey:)'s false-default can't express.
        syncQuantitySamples = defaults.object(forKey: "syncQuantitySamples") as? Bool ?? true
        syncCategorySamples = defaults.object(forKey: "syncCategorySamples") as? Bool ?? true
        syncWorkouts = defaults.object(forKey: "syncWorkouts") as? Bool ?? true
        syncWorkoutRoutes = defaults.object(forKey: "syncWorkoutRoutes") as? Bool ?? true
        backgroundSyncEnabled = defaults.object(forKey: "backgroundSyncEnabled") as? Bool ?? true
        minimumSyncInterval = defaults.object(forKey: "minimumSyncInterval") as? Int ?? 30
        syncOnHealthUpdate = defaults.object(forKey: "syncOnHealthUpdate") as? Bool ?? true
        syncAfterWorkout = defaults.object(forKey: "syncAfterWorkout") as? Bool ?? true
        dailySyncEnabled = defaults.object(forKey: "dailySyncEnabled") as? Bool ?? false
        dailySyncMinute = defaults.object(forKey: "dailySyncMinute") as? Int ?? 7 * 60
        lastBackgroundSyncAt = defaults.object(forKey: "lastBackgroundSyncAt") as? Date
        authorizedTypesSignature = defaults.string(forKey: "authorizedTypesSignature") ?? ""
    }

    /// Fuel needs a token; a self-hosted destination only needs somewhere to send to.
    var isConfigured: Bool { isFuelDestination ? !token.isEmpty : !endpoint.isEmpty }

    // MARK: Anchors — one opaque HKQueryAnchor per data type, base64-encoded.

    private var anchorsURL: URL {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory.appendingPathComponent("anchors.json")
    }

    func loadAnchors() -> [String: String] {
        guard let data = try? Data(contentsOf: anchorsURL) else { return [:] }
        return (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:]
    }

    func saveAnchor(_ anchor: String, for type: String) {
        var anchors = loadAnchors()
        anchors[type] = anchor
        if let data = try? JSONEncoder().encode(anchors) {
            try? data.write(to: anchorsURL, options: .atomic)
        }
    }

    func replaceAnchors(_ anchors: [String: String]) {
        if let data = try? JSONEncoder().encode(anchors) {
            try? data.write(to: anchorsURL, options: .atomic)
        }
    }

    func resetForFullSync() {
        try? FileManager.default.removeItem(at: anchorsURL)
        initialSyncComplete = false
    }
}

// Minimal Keychain wrapper — one generic-password item per key.
enum Keychain {
    static func set(_ value: String, for key: String) {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: key]
        SecItemDelete(query as CFDictionary)
        guard !value.isEmpty, let data = value.data(using: .utf8) else { return }
        var insert = query
        insert[kSecValueData as String] = data
        insert[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(insert as CFDictionary, nil)
    }

    static func get(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
