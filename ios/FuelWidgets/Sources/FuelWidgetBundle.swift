import SwiftUI
import WidgetKit

// Every widget Fuel offers. They are separate kinds rather than one configurable widget
// so each shows up by name in the gallery with its own preview — picking "Energy rings"
// from a list of pictures is easier than adding one widget and then hunting for the
// right variant in an edit sheet.
//
// Tapping any of them opens the tab it came from, via fuel://<tab>.

@main
struct FuelWidgetBundle: WidgetBundle {
    var body: some Widget {
        EnergyRingsWidget()
        EnergyBarsWidget()
        EnergyGaugeWidget()
        EnergySplitWidget()
        EnergyStackWidget()
        BalanceHistoryWidget()
        NutritionWidget()
        MacroRingsWidget()
        RemainingWidget()
        VitalsWidget()
        HeartWidget()
        StepsWidget()
        ActivityRingsWidget()
        SleepWidget()
        BalanceTrendWidget()
        QuickLogWidget()
    }
}

/// Every widget is the same three lines — kind, families, destination — so this spells
/// them once rather than sixteen times.
private struct FuelWidgetShell<Content: View>: View {
    var entry: FuelEntry
    var destination: String
    @ViewBuilder var content: Content

    var body: some View {
        content.widgetURL(URL(string: "fuel://\(destination)"))
    }
}

struct EnergyRingsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FuelEnergyRings", provider: FuelProvider()) { entry in
            FuelWidgetShell(entry: entry, destination: "today") { EnergyRingsView(entry: entry) }
        }
        .configurationDisplayName("Energy rings")
        .description("Today's deficit, with eaten, active and resting as rings.")
        .supportedFamilies([.systemSmall])
    }
}

struct EnergyBarsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FuelEnergyBars", provider: FuelProvider()) { entry in
            FuelWidgetShell(entry: entry, destination: "today") { EnergyBarsView(entry: entry) }
        }
        .configurationDisplayName("Energy bars")
        .description("Burned, consumed, active and resting as bars.")
        .supportedFamilies([.systemMedium])
    }
}

struct EnergyGaugeWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FuelEnergyGauge", provider: FuelProvider()) { entry in
            FuelWidgetShell(entry: entry, destination: "today") { EnergyGaugeView(entry: entry) }
        }
        .configurationDisplayName("Energy gauge")
        .description("One dial for today's deficit or surplus.")
        .supportedFamilies([.systemSmall])
    }
}

struct EnergySplitWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FuelEnergySplit", provider: FuelProvider()) { entry in
            FuelWidgetShell(entry: entry, destination: "today") { EnergySplitView(entry: entry) }
        }
        .configurationDisplayName("Burn split")
        .description("How much of today's burn was active versus resting.")
        .supportedFamilies([.systemMedium])
    }
}

struct EnergyStackWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FuelEnergyStack", provider: FuelProvider()) { entry in
            FuelWidgetShell(entry: entry, destination: "today") { EnergyStackView(entry: entry) }
        }
        .configurationDisplayName("In versus out")
        .description("Calories out stacked against calories in.")
        .supportedFamilies([.systemMedium])
    }
}

struct BalanceHistoryWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FuelBalanceHistory", provider: FuelProvider()) { entry in
            FuelWidgetShell(entry: entry, destination: "today") { BalanceHistoryView(entry: entry) }
        }
        .configurationDisplayName("Deficit and surplus")
        .description("The daily balance bars, with your averages.")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}

struct NutritionWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FuelNutrition", provider: FuelProvider()) { entry in
            FuelWidgetShell(entry: entry, destination: "today") { NutritionView(entry: entry) }
        }
        .configurationDisplayName("Nutrition")
        .description("Calories eaten and your macros against goal.")
        .supportedFamilies([.systemMedium])
    }
}

struct MacroRingsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FuelMacroRings", provider: FuelProvider()) { entry in
            FuelWidgetShell(entry: entry, destination: "today") { MacroRingsView(entry: entry) }
        }
        .configurationDisplayName("Macro rings")
        .description("Protein, carbs and fat as rings.")
        .supportedFamilies([.systemSmall])
    }
}

struct RemainingWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FuelRemaining", provider: FuelProvider()) { entry in
            FuelWidgetShell(entry: entry, destination: "today") { RemainingView(entry: entry) }
        }
        .configurationDisplayName("Left to eat")
        .description("What's left of today's calorie goal.")
        .supportedFamilies([.systemSmall])
    }
}

struct VitalsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FuelVitals", provider: FuelProvider()) { entry in
            FuelWidgetShell(entry: entry, destination: "today") { VitalsWidgetView(entry: entry) }
        }
        .configurationDisplayName("Vitals")
        .description("Today's vitals score and how each reading compares to your usual.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct HeartWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FuelHeart", provider: FuelProvider()) { entry in
            FuelWidgetShell(entry: entry, destination: "today") { HeartView(entry: entry) }
        }
        .configurationDisplayName("Heart")
        .description("Resting heart rate and HRV against your baseline.")
        .supportedFamilies([.systemSmall])
    }
}

struct StepsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FuelSteps", provider: FuelProvider()) { entry in
            FuelWidgetShell(entry: entry, destination: "today") { StepsView(entry: entry) }
        }
        .configurationDisplayName("Steps")
        .description("Steps against your goal, with distance and flights.")
        .supportedFamilies([.systemSmall])
    }
}

struct ActivityRingsWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FuelActivityRings", provider: FuelProvider()) { entry in
            FuelWidgetShell(entry: entry, destination: "today") { ActivityRingsView(entry: entry) }
        }
        .configurationDisplayName("Activity")
        .description("Move, exercise and stand for today.")
        .supportedFamilies([.systemMedium])
    }
}

struct SleepWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FuelSleep", provider: FuelProvider()) { entry in
            FuelWidgetShell(entry: entry, destination: "today") { SleepView(entry: entry) }
        }
        .configurationDisplayName("Sleep")
        .description("Last night's sleep.")
        .supportedFamilies([.systemSmall])
    }
}

struct BalanceTrendWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FuelBalanceTrend", provider: FuelProvider()) { entry in
            FuelWidgetShell(entry: entry, destination: "trends") { BalanceTrendView(entry: entry) }
        }
        .configurationDisplayName("Balance trend")
        .description("The shape of your recent deficit and surplus days.")
        .supportedFamilies([.systemSmall])
    }
}

struct QuickLogWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "FuelQuickLog", provider: FuelProvider()) { entry in
            FuelWidgetShell(entry: entry, destination: "log") { QuickLogView(entry: entry) }
        }
        .configurationDisplayName("Log a meal")
        .description("Opens straight into the camera.")
        .supportedFamilies([.systemSmall])
    }
}
