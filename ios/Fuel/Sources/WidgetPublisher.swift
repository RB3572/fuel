import Foundation
import SwiftUI
import WidgetKit

// Turns whatever the app currently knows into the snapshot the Home Screen widgets
// read, and asks WidgetKit to redraw. Called after every dashboard load and whenever
// the palette changes, because a widget showing yesterday's numbers in last week's
// colors is worse than no widget.

@MainActor
enum WidgetPublisher {
    static func publish(dashboard: Dashboard?, goals: GoalValues?) {
        guard let dashboard else { return }
        let summary = dashboard.today.summary
        let theme = DashboardTheme.shared
        let signal = computeVitalsSignal(trends: dashboard.trends, summary: summary)

        // Burned minus eaten, so positive is a deficit — the same sign the Today card
        // uses when it says "303 kcal deficit".
        let deficit: Double? = {
            guard let burned = summary.totalExpenditure, let eaten = summary.caloriesConsumed else { return nil }
            return burned - eaten
        }()

        let days = dashboard.trends.suffix(14).compactMap { day -> FuelWidgetDay? in
            guard let burned = day.totalExpenditure, let eaten = day.caloriesConsumed else { return nil }
            return FuelWidgetDay(date: day.date, balance: eaten - burned)
        }

        let snapshot = FuelWidgetSnapshot(
            updated: Date(),
            palette: FuelWidgetPalette(
                primary: hex(theme.primary), secondary: hex(theme.secondary),
                tertiary: hex(theme.tertiary), positive: hex(theme.positive),
                negative: hex(theme.negative)),
            consumed: summary.caloriesConsumed,
            active: summary.activeEnergy,
            resting: summary.restingEnergy,
            burned: summary.totalExpenditure,
            deficit: deficit,
            calorieGoal: goals?.calories ?? dashboard.goals?.calories?.target,
            protein: summary.protein, carbs: summary.carbs, fat: summary.fat, fiber: summary.fiber,
            proteinGoal: dashboard.goals?.protein?.target,
            carbsGoal: dashboard.goals?.carbs?.target,
            fatGoal: dashboard.goals?.fat?.target,
            fiberGoal: dashboard.goals?.fiber?.target,
            entriesLogged: dashboard.today.foodEntries.count,
            steps: summary.stepCount,
            stepGoal: dashboard.goals?.steps?.target,
            exerciseMinutes: summary.exerciseMinutes,
            standMinutes: summary.standMinutes,
            distanceMiles: summary.distanceMiles,
            flightsClimbed: summary.flightsClimbed,
            sleepHours: summary.sleepHours,
            vitalsScore: signal.score,
            vitals: signal.items.filter { !$0.insufficient }.map {
                FuelWidgetVital(label: shortLabel($0.key), value: $0.today, unit: $0.key.unit,
                                decimals: $0.key.decimals, center: $0.center,
                                flagDirection: ($0.flagged || $0.watch) ? $0.direction : nil)
            },
            days: Array(days),
            avgBurned: dashboard.energyAverages?.totalExpenditure,
            avgResting: dashboard.energyAverages?.restingEnergy,
            avgActive: dashboard.energyAverages?.activeEnergy,
            avgBalance: dashboard.energyAverages?.energyBalance)

        FuelWidgetStore.save(snapshot)
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// Repaints the widgets with a new palette without waiting for the next sync, so
    /// picking a color scheme changes the Home Screen at the same moment it changes the
    /// app.
    static func republishPalette() {
        guard var snapshot = FuelWidgetStore.load() else { return }
        let theme = DashboardTheme.shared
        snapshot.palette = FuelWidgetPalette(
            primary: hex(theme.primary), secondary: hex(theme.secondary),
            tertiary: hex(theme.tertiary), positive: hex(theme.positive), negative: hex(theme.negative))
        FuelWidgetStore.save(snapshot)
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// "Resting heart rate" does not fit a small widget row; "Resting HR" does.
    private static func shortLabel(_ key: VitalKey) -> String {
        switch key {
        case .restingHeartRate: return "Resting HR"
        case .walkingHeartRateAverage: return "Walking HR"
        case .respiratoryRate: return "Breathing"
        case .bloodOxygen: return "Blood oxygen"
        case .cardioRecovery: return "Cardio recovery"
        case .hrv: return "HRV"
        }
    }

    private static func hex(_ color: Color) -> UInt32 {
        UInt32(color.hexString, radix: 16) ?? 0x2C7A7B
    }
}
