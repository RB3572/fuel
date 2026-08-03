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
