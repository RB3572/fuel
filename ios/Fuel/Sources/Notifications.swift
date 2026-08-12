import Foundation
import UIKit
import UserNotifications

// Notifications, all of which come from the Coach: an answer that finished while you were
// elsewhere, or a reaction to a workout that just synced. Nothing here nags — Fuel never
// sends "you haven't logged lunch". A notification means the Coach has something it
// worked out, which is the only thing worth interrupting someone for.
//
// One master switch, because a settings screen with six toggles for one feature is worse
// than a switch that means what it says.

@MainActor
@Observable
final class Notifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifications()

    private let center = UNUserNotificationCenter.current()
    private static let enabledKey = "fuelNotificationsEnabled"
    private static let seenWorkoutsKey = "fuelNotifiedWorkouts"

    /// Whether the user wants notifications at all. Off until they turn it on: an app
    /// that asks for permission on first launch, before it has anything to say, gets
    /// declined and then can never ask again.
    var enabled: Bool {
        didSet {
            UserDefaults.standard.set(enabled, forKey: Self.enabledKey)
            if enabled { Task { await requestAuthorization() } }
        }
    }

    /// Set when the system has been asked and said no, so the UI can explain that the
    /// switch alone will not fix it.
    private(set) var deniedBySystem = false

    /// Tapping a Coach notification sets this; RootView consumes it to open the chat.
    var openCoachRequested = false

    private override init() {
        enabled = UserDefaults.standard.bool(forKey: Self.enabledKey)
        super.init()
        center.delegate = self
    }

    @discardableResult
    func requestAuthorization() async -> Bool {
        do {
            let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
            deniedBySystem = !granted
            return granted
        } catch {
            deniedBySystem = true
            return false
        }
    }

    func refreshAuthorizationState() async {
        let settings = await center.notificationSettings()
        deniedBySystem = settings.authorizationStatus == .denied
    }

    /// Posts a Coach message. Silently does nothing when the app is in the foreground:
    /// the message is already on screen there, and a banner over the chat you are
    /// reading is noise.
    func postCoachMessage(_ body: String, title: String = "Fuel Coach") async {
        guard enabled else { return }
        guard UIApplication.shared.applicationState != .active else { return }
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = String(body.prefix(400))
        content.sound = .default
        content.userInfo = ["destination": "coach"]
        // No trigger: deliver now. A scheduled notification would be a reminder, and
        // this is a reply.
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        try? await center.add(request)
    }

    // MARK: - Workout de-duplication

    /// Whether this workout has already been reacted to. Sync re-reads the same day
    /// repeatedly, so without this the Coach would congratulate you for one swim every
    /// time the app opened.
    func isNewWorkout(_ key: String) -> Bool {
        !seenWorkouts.contains(key)
    }

    func markWorkoutSeen(_ key: String) {
        var seen = seenWorkouts
        seen.insert(key)
        // Keep the set from growing forever; a workout from last month cannot arrive
        // late enough to matter.
        UserDefaults.standard.set(Array(seen.suffix(200)), forKey: Self.seenWorkoutsKey)
    }

    private var seenWorkouts: Set<String> {
        Set(UserDefaults.standard.stringArray(forKey: Self.seenWorkoutsKey) ?? [])
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// Foreground delivery is suppressed at the source above, so this only fires for
    /// notifications posted just as the app came forward. Show nothing.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification) async
        -> UNNotificationPresentationOptions { [] }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse) async {
        let destination = response.notification.request.content.userInfo["destination"] as? String
        await MainActor.run {
            if destination == "coach" { Notifications.shared.openCoachRequested = true }
        }
    }
}
