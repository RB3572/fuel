import SwiftUI

// The metrics that arrive in `DaySummary.extras`: what each key means, what unit it is
// in, and which card it belongs on. One table so a new metric appears on the dashboard
// by adding a line here rather than by editing a view.
//
// Everything is one value per day by design. A heart rate every minute of the night
// answers no question this app asks, and storing it would make the database enormous for
// no gain — so the sync summarises before it uploads, and this describes the summary.

struct HealthExtra: Identifiable {
    enum Group: String, CaseIterable {
        case cardiac = "Heart"
        case fitness = "Fitness detail"
        case respiratory = "Breathing"
        case body = "Body"
        case environment = "Environment"
        case mobility = "Walking quality"
    }

    var key: String
    var label: String
    var unit: String
    var decimals: Int = 0
    var group: Group
    /// What the number means, shown under it — these are unfamiliar enough that a bare
    /// figure is not much use.
    var note: String?

    var id: String { key }
}

enum HealthExtras {
    static let all: [HealthExtra] = [
        // Heart
        HealthExtra(key: "heartRateAverage", label: "Average heart rate", unit: "bpm", group: .cardiac),
        HealthExtra(key: "heartRateMin", label: "Lowest heart rate", unit: "bpm", group: .cardiac),
        HealthExtra(key: "heartRateMax", label: "Highest heart rate", unit: "bpm", group: .cardiac),
        HealthExtra(key: "atrialFibrillationBurden", label: "AFib burden", unit: "%", decimals: 1, group: .cardiac,
                    note: "Share of the day in atrial fibrillation, if your watch tracks it."),
        HealthExtra(key: "peripheralPerfusionIndex", label: "Perfusion index", unit: "%", decimals: 1, group: .cardiac,
                    note: "How strong the blood-flow signal was where it was measured."),
        HealthExtra(key: "bloodPressureSystolic", label: "Blood pressure (systolic)", unit: "mmHg", group: .cardiac),
        HealthExtra(key: "bloodPressureDiastolic", label: "Blood pressure (diastolic)", unit: "mmHg", group: .cardiac),
        HealthExtra(key: "bloodGlucose", label: "Blood glucose", unit: "mg/dL", group: .cardiac),

        // Fitness detail
        HealthExtra(key: "runningPower", label: "Running power", unit: "W", group: .fitness),
        HealthExtra(key: "runningSpeed", label: "Running speed", unit: "m/s", decimals: 2, group: .fitness),
        HealthExtra(key: "runningGroundContactTime", label: "Ground contact", unit: "ms", group: .fitness,
                    note: "How long each foot stays down. Lower usually means a quicker turnover."),
        HealthExtra(key: "runningVerticalOscillation", label: "Vertical oscillation", unit: "cm", decimals: 1, group: .fitness,
                    note: "How much you bounce. Less of it is generally less wasted effort."),
        HealthExtra(key: "cyclingPower", label: "Cycling power", unit: "W", group: .fitness),
        HealthExtra(key: "cyclingCadence", label: "Cycling cadence", unit: "rpm", group: .fitness),
        HealthExtra(key: "cyclingFunctionalThresholdPower", label: "Functional threshold power", unit: "W", group: .fitness,
                    note: "The power you could hold for about an hour."),
        HealthExtra(key: "stairAscentSpeed", label: "Stair ascent speed", unit: "m/s", decimals: 2, group: .fitness),
        HealthExtra(key: "stairDescentSpeed", label: "Stair descent speed", unit: "m/s", decimals: 2, group: .fitness),
        HealthExtra(key: "sixMinuteWalkTestDistance", label: "Six-minute walk", unit: "m", group: .fitness),
        HealthExtra(key: "physicalEffort", label: "Physical effort", unit: "MET", decimals: 1, group: .fitness),

        // Breathing
        HealthExtra(key: "peakExpiratoryFlowRate", label: "Peak flow", unit: "L/min", group: .respiratory),
        HealthExtra(key: "forcedVitalCapacity", label: "Forced vital capacity", unit: "L", decimals: 2, group: .respiratory),
        HealthExtra(key: "forcedExpiratoryVolume1", label: "FEV1", unit: "L", decimals: 2, group: .respiratory),
        HealthExtra(key: "inhalerUsage", label: "Inhaler uses", unit: "", group: .respiratory),

        // Body
        HealthExtra(key: "waistCircumference", label: "Waist", unit: "in", decimals: 1, group: .body),
        HealthExtra(key: "bodyTemperature", label: "Body temperature", unit: "°C", decimals: 1, group: .body),
        HealthExtra(key: "basalBodyTemperature", label: "Basal temperature", unit: "°C", decimals: 1, group: .body),
        HealthExtra(key: "wristTemperature", label: "Sleeping wrist temperature", unit: "°C", decimals: 1, group: .body,
                    note: "Measured overnight; the change from your own baseline is what matters."),

        // Environment
        HealthExtra(key: "timeInDaylight", label: "Time in daylight", unit: "min", group: .environment),
        HealthExtra(key: "uvExposure", label: "Peak UV index", unit: "", group: .environment),
        HealthExtra(key: "headphoneAudioExposure", label: "Headphone volume", unit: "dB", group: .environment,
                    note: "Sustained exposure above 80 dB is where hearing risk begins."),
        HealthExtra(key: "environmentalSoundLevel", label: "Surrounding noise", unit: "dB", group: .environment),

        // Walking quality
        HealthExtra(key: "walkingSpeed", label: "Walking speed", unit: "m/s", decimals: 2, group: .mobility),
        HealthExtra(key: "walkingStepLength", label: "Step length", unit: "cm", group: .mobility),
        HealthExtra(key: "walkingAsymmetry", label: "Asymmetry", unit: "%", decimals: 1, group: .mobility,
                    note: "How unevenly the two legs move. Lower is steadier."),
        HealthExtra(key: "walkingDoubleSupport", label: "Double support", unit: "%", decimals: 1, group: .mobility,
                    note: "Share of each step with both feet down."),
        HealthExtra(key: "walkingSteadiness", label: "Walking steadiness", unit: "%", decimals: 0, group: .mobility),
        HealthExtra(key: "numberOfTimesFallen", label: "Falls detected", unit: "", group: .mobility),
    ]

    static func inGroup(_ group: HealthExtra.Group) -> [HealthExtra] { all.filter { $0.group == group } }

    /// The metrics in a group that actually have a value on this day. A card with
    /// nothing in it is not shown at all, which is why this returns the pairs rather
    /// than the definitions.
    static func present(_ group: HealthExtra.Group, in summary: DaySummary?) -> [(HealthExtra, Double)] {
        guard let extras = summary?.extras else { return [] }
        return inGroup(group).compactMap { definition in
            guard let value = extras[definition.key] else { return nil }
            return (definition, value)
        }
    }
}

/// The sleep keys, which are their own shape — stages, timing and quality rather than a
/// list of independent readings.
struct SleepNight {
    var hours: Double?
    var remMinutes: Double?
    var coreMinutes: Double?
    var deepMinutes: Double?
    var unspecifiedMinutes: Double?
    var awakeMinutes: Double?
    var awakenings: Double?
    var inBedMinutes: Double?
    var efficiency: Double?
    var latencyMinutes: Double?
    /// Minutes from the midnight the night ended on, so a bedtime before midnight is
    /// negative — 23:30 is -30, not 1410.
    var startMinutes: Double?
    var endMinutes: Double?

    init?(_ summary: DaySummary?) {
        guard let summary else { return nil }
        let extras = summary.extras ?? [:]
        hours = summary.sleepHours
        remMinutes = extras["sleepREMMinutes"]
        coreMinutes = extras["sleepCoreMinutes"]
        deepMinutes = extras["sleepDeepMinutes"]
        unspecifiedMinutes = extras["sleepUnspecifiedMinutes"]
        awakeMinutes = extras["sleepAwakeMinutes"]
        awakenings = extras["sleepAwakenings"]
        inBedMinutes = extras["sleepInBedMinutes"]
        efficiency = extras["sleepEfficiency"]
        latencyMinutes = extras["sleepLatencyMinutes"]
        startMinutes = extras["sleepStartMinutes"]
        endMinutes = extras["sleepEndMinutes"]
        // Nothing to show unless the night produced at least one of these.
        let anything: [Double?] = [hours, remMinutes, coreMinutes, deepMinutes]
        if anything.allSatisfy({ $0 == nil }) { return nil }
    }

    var hasStages: Bool {
        let rem: Double = remMinutes ?? 0
        let core: Double = coreMinutes ?? 0
        let deep: Double = deepMinutes ?? 0
        return rem + core + deep > 0
    }

    /// "11:32pm" from minutes-around-midnight.
    static func clock(_ minutes: Double?) -> String? {
        guard let minutes else { return nil }
        var total = Int(minutes.rounded())
        while total < 0 { total += 24 * 60 }
        total %= 24 * 60
        var components = DateComponents()
        components.hour = total / 60
        components.minute = total % 60
        guard let date = Calendar.current.date(from: components) else { return nil }
        return date.formatted(.dateTime.hour().minute())
    }

    static func duration(_ minutes: Double?) -> String? {
        guard let minutes, minutes > 0 else { return nil }
        let whole = Int(minutes.rounded())
        return whole >= 60 ? "\(whole / 60)h \(whole % 60)m" : "\(whole)m"
    }
}
