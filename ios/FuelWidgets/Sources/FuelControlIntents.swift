import AppIntents
import Foundation

// The two things a Lock Screen or Control Center control can ask Fuel to do. Split into
// their own file, compiled into BOTH the app and the widget extension targets (see
// project.yml), because a Control's AppIntent has been reported not to reliably
// foreground the app unless the app target itself also carries the intent's type — the
// system has to be able to resolve it there, not only in the extension that ran it.
//
// Controls open the app through `OpenURLIntent`, and only through a universal link:
// unlike the Home Screen widgets' `widgetURL`, a Control silently does nothing if given
// a custom `fuel://` scheme. fuel.rishib.com/open is that universal link — see
// /.well-known/apple-app-site-association on the server and the associated-domains
// entitlement in project.yml.

struct LogMealIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a meal"
    static var description = IntentDescription("Opens Fuel's camera so you can photograph what you're eating.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(URL(string: "https://fuel.rishib.com/open?dest=log")!))
    }
}

struct OpenTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "Today's balance"
    static var description = IntentDescription("Opens Fuel's dashboard.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(URL(string: "https://fuel.rishib.com/open?dest=today")!))
    }
}
