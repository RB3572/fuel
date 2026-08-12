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
