import Foundation
import CoreLocation

/// One location fix per app open, mirroring the website's own capture
/// (`useLocationCapture` in src/App.tsx): quiet, foreground-only via requestLocation()
/// rather than continuous tracking, gated by a 10-minute cooldown, and left alone once
/// the user declines — the next open tries again only if they later grant access from
/// Settings, via locationManagerDidChangeAuthorization below.
@MainActor
final class LocationSampler: NSObject, CLLocationManagerDelegate {
    static let shared = LocationSampler()

    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation?, Never>?
    private static let gapSeconds: TimeInterval = 10 * 60

    private override init() {
        super.init()
        manager.delegate = self
    }

    var trackingEnabled: Bool {
        get { !UserDefaults.standard.bool(forKey: "fuelLocationOff") }
        set { UserDefaults.standard.set(!newValue, forKey: "fuelLocationOff") }
    }

    func captureIfDue() async {
        // Matches the website's own gate (useLocationCapture(session.authenticated)):
        // never prompt before the user has even signed in.
        guard AppStore.shared.isSignedIn, trackingEnabled else { return }
        let last = UserDefaults.standard.double(forKey: "fuelLocationAt")
        if last > 0, Date().timeIntervalSince1970 - last < Self.gapSeconds { return }
        switch manager.authorizationStatus {
        case .denied, .restricted:
            return
        case .notDetermined:
            // Ask, but don't block this open on the answer — the next open (or the
            // authorization-changed callback below) picks up a fix once granted.
            manager.requestWhenInUseAuthorization()
            return
        default:
            break
        }
        guard let location = await requestLocation() else { return }
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "fuelLocationAt")
        await AppStore.shared.recordLocation(location)
    }

    /// A fix taken specifically to tag a meal, rather than the ambient one-per-open
    /// capture above. It ignores the cooldown — the point of this fix is the entry in
    /// front of it, and a throttled miss would leave that meal with no place at all —
    /// but it still respects the user's toggle and never prompts on its own: if they
    /// have not already granted location, the meal is simply logged without a place.
    func fixForLogging() async -> MealFix? {
        guard trackingEnabled else { return nil }
        let status = manager.authorizationStatus
        guard status == .authorizedWhenInUse || status == .authorizedAlways else { return nil }
        guard let location = await requestLocation() else { return nil }
        return MealFix(latitude: location.coordinate.latitude,
                       longitude: location.coordinate.longitude,
                       accuracy: location.horizontalAccuracy)
    }

    private func requestLocation() async -> CLLocation? {
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            manager.requestLocation()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in
            continuation?.resume(returning: locations.last)
            continuation = nil
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            continuation?.resume(returning: nil)
            continuation = nil
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            let status = manager.authorizationStatus
            if status == .authorizedWhenInUse || status == .authorizedAlways {
                await captureIfDue()
            }
        }
    }
}

/// The coordinate sent alongside a logged meal so the server can tag it with a place.
struct MealFix: Sendable {
    var latitude: Double
    var longitude: Double
    var accuracy: Double?

    func apply(to body: inout [String: Any]) {
        body["latitude"] = latitude
        body["longitude"] = longitude
        if let accuracy, accuracy > 0 { body["accuracy"] = accuracy }
    }
}
