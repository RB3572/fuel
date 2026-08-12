import AppIntents
import SwiftUI
import WidgetKit

// Controls — the buttons you can put on the Lock Screen, in Control Center, or on the
// Action button. A control is not a small widget: it shows no data and does one thing
// when pressed, so the only one worth having is the action Fuel exists for. Logging a
// meal from the Lock Screen skips unlocking, finding the app and reaching the Log tab.

/// Opens Fuel straight into the camera. It reuses the same `fuel://log` route the
/// widgets tap through, so there is one deep-link vocabulary rather than a separate
/// mechanism for controls.
struct LogMealIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a meal"
    static var description = IntentDescription("Opens Fuel's camera so you can photograph what you're eating.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(URL(string: "fuel://log")!))
    }
}

struct LogMealControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.labloggercompany.fuel.control.log") {
            ControlWidgetButton(action: LogMealIntent()) {
                Label("Log a meal", systemImage: "camera.fill")
            }
        }
        .displayName("Log a meal")
        .description("Open Fuel's camera to log what you're eating.")
    }
}

/// The other thing people open Fuel for: checking where the day stands.
struct OpenTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "Today's balance"
    static var description = IntentDescription("Opens Fuel's dashboard.")
    static var openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(URL(string: "fuel://today")!))
    }
}

struct OpenTodayControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "com.labloggercompany.fuel.control.today") {
            ControlWidgetButton(action: OpenTodayIntent()) {
                Label("Today's balance", systemImage: "flame.fill")
            }
        }
        .displayName("Today's balance")
        .description("Open Fuel's dashboard.")
    }
}
