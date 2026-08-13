import SwiftUI
import WidgetKit

// Controls — the buttons you can put on the Lock Screen, in Control Center, or on the
// Action button. A control is not a small widget: it shows no data and does one thing
// when pressed, so the only ones worth having are the two things Fuel is opened for.
//
// The intents these buttons run (LogMealIntent, OpenTodayIntent) live in
// FuelControlIntents.swift rather than here, because they are compiled into both this
// extension and the main app target — see that file's header for why.

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
