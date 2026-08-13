import Foundation
import UIKit
import UserNotifications

// Notifications, all of which come from the Coach — nothing here nags; Fuel never sends
// "you haven't logged lunch". There are two different kinds, though, and they behave
// differently on purpose:
//
//   - A reply finishing while you've left the app is answering something YOU asked.
//     That is never optional in the way outreach is — it stays on by default and is not
//     controlled by "Let coach message me", which is only about the coach speaking up
//     first.
//   - Workout reactions and the weekly rundown are the coach speaking up first, with
//     nothing prompting it. Both live behind "Let coach message me", plus their own
//     toggle, so turning the master switch off silences every kind of outreach at once.

@MainActor
@Observable
final class Notifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifications()

    private let center = UNUserNotificationCenter.current()
    private static let proactiveKey = "fuelNotificationsEnabled"
    private static let repliesKey = "fuelNotifyReplies"
    private static let workoutKey = "fuelNotifyWorkouts"
    private static let weeklyKey = "fuelNotifyWeekly"
    private static let seenWorkoutsKey = "fuelNotifiedWorkouts"

    /// "Let coach message me" — the master switch for the coach reaching out first.
    /// Off until turned on: asking for permission before the app has anything to say
    /// gets declined, and then can never ask again.
    var proactiveEnabled: Bool {
        didSet {
            UserDefaults.standard.set(proactiveEnabled, forKey: Self.proactiveKey)
            if proactiveEnabled { Task { await requestAuthorization() } }
        }
    }

    /// A reply finishing while you're away. On by default, and untouched by
    /// `proactiveEnabled` — answering what you asked isn't the coach speaking up first.
    var repliesEnabled: Bool {
        didSet {
            UserDefaults.standard.set(repliesEnabled, forKey: Self.repliesKey)
            if repliesEnabled { Task { await requestAuthorization() } }
        }
    }

    var workoutReactionsEnabled: Bool {
        didSet { UserDefaults.standard.set(workoutReactionsEnabled, forKey: Self.workoutKey) }
    }

    var weeklyRundownEnabled: Bool {
        didSet { UserDefaults.standard.set(weeklyRundownEnabled, forKey: Self.weeklyKey) }
    }

    /// Set when the system has been asked and said no, so the UI can explain that a
    /// toggle alone will not fix it.
    private(set) var deniedBySystem = false

    /// Tapping a Coach notification sets this; RootView consumes it to open the chat.
    var openCoachRequested = false

    private override init() {
        let d = UserDefaults.standard
        proactiveEnabled = d.bool(forKey: Self.proactiveKey)
        // These three default to on — unlike the master switch, which defaults off —
        // because they only ever fire once something has already turned proactive
        // outreach on, or (for replies) they're not proactive at all.
        repliesEnabled = d.object(forKey: Self.repliesKey) == nil ? true : d.bool(forKey: Self.repliesKey)
        workoutReactionsEnabled = d.object(forKey: Self.workoutKey) == nil ? true : d.bool(forKey: Self.workoutKey)
        weeklyRundownEnabled = d.object(forKey: Self.weeklyKey) == nil ? true : d.bool(forKey: Self.weeklyKey)
        super.init()
        center.delegate = self
    }

    /// Whether a workout reaction may fire at all: its own toggle and the master switch
    /// both have to allow it.
    var canReactToWorkouts: Bool { proactiveEnabled && workoutReactionsEnabled }
    /// Whether the Saturday rundown may fire at all — same rule.
    var canSendWeeklyRundown: Bool { proactiveEnabled && weeklyRundownEnabled }

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

    /// An answer that finished while the person was elsewhere. Gated only on
    /// `repliesEnabled`, never on the proactive master switch.
    func postReply(_ body: String) async {
        guard repliesEnabled else { return }
        await post(body, title: "Fuel Coach")
    }

    /// The coach speaking up with nothing prompting it — a workout reaction or the
    /// weekly rundown. Callers check `canReactToWorkouts`/`canSendWeeklyRundown` before
    /// doing the work to produce `body` at all; this checks the master switch again as
    /// a backstop in case that state changed in between.
    func postProactive(_ body: String, title: String) async {
        guard proactiveEnabled else { return }
        await post(body, title: title)
    }

    /// Silently does nothing when the app is in the foreground: the message is already
    /// on screen there, and a banner over the chat you are reading is noise.
    private func post(_ body: String, title: String) async {
        guard UIApplication.shared.applicationState != .active else { return }
        let settings = await center.notificationSettings()
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = String(body.prefix(400))
        content.sound = .default
        content.userInfo = ["destination": "coach"]
        // No trigger: deliver now. A scheduled notification would be a reminder, and
        // this is a reply or a reaction to something that already happened.
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

    // MARK: - Weekly rundown de-duplication

    private static let lastWeeklyKey = "fuelLastWeeklyRundownWeek"

    /// True at most once per calendar week (Sunday-start, matching a Saturday-morning
    /// delivery falling near the end of "this week" rather than spilling into the next).
    func isDueForWeeklyRundown(now: Date = Date()) -> Bool {
        let calendar = Calendar.current
        guard let weekday = calendar.dateComponents([.weekday], from: now).weekday, weekday == 7 else { return false } // Saturday
        let hour = calendar.component(.hour, from: now)
        guard hour >= 7 else { return false } // "morning" — not the middle of Friday night
        guard let week = calendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: now).weekOfYear,
              let year = calendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: now).yearForWeekOfYear else { return false }
        let stamp = "\(year)-W\(week)"
        return UserDefaults.standard.string(forKey: Self.lastWeeklyKey) != stamp
    }

    func markWeeklyRundownSent(now: Date = Date()) {
        let calendar = Calendar.current
        let components = calendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: now)
        guard let week = components.weekOfYear, let year = components.yearForWeekOfYear else { return }
        UserDefaults.standard.set("\(year)-W\(week)", forKey: Self.lastWeeklyKey)
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
