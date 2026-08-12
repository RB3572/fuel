import Foundation
import SwiftUI

// What the Home Screen widgets read. Widgets run in their own process and cannot sign
// in, call the API, or touch HealthKit on the app's behalf, so the app writes a small
// snapshot into the shared App Group container every time its dashboard changes and the
// widgets render whatever is there. This file is compiled into both targets, so the
// shape can never drift between writer and reader.
//
// The snapshot carries the palette too. A widget that ignored the user's chosen colors
// would be the one place in the app that does.

enum FuelWidgetStore {
    static let appGroup = "group.com.labloggercompany.fuel"
    private static let filename = "widget-snapshot.json"

    private static var url: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent(filename)
    }

    static func save(_ snapshot: FuelWidgetSnapshot) {
        guard let url, let data = try? JSONEncoder().encode(snapshot) else { return }
        try? data.write(to: url, options: .atomic)
    }

    static func load() -> FuelWidgetSnapshot? {
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(FuelWidgetSnapshot.self, from: data)
    }
}

/// One day of the deficit/surplus strip.
struct FuelWidgetDay: Codable, Hashable {
    var date: String
    /// Positive means a surplus (ate more than burned), negative a deficit — the same
    /// sign convention as the chart on Today, so the colors mean the same thing.
    var balance: Double
}

struct FuelWidgetVital: Codable, Hashable {
    var label: String
    var value: Double
    var unit: String
    var decimals: Int
    var center: Double?
    /// nil = typical, "up"/"down" = unusual in that direction.
    var flagDirection: String?
}

struct FuelWidgetPalette: Codable, Hashable {
    var primary: UInt32
    var secondary: UInt32
    var tertiary: UInt32
    var positive: UInt32
    var negative: UInt32

    static let fallback = FuelWidgetPalette(primary: 0x2C7A7B, secondary: 0xE8674C,
                                            tertiary: 0x4FD1C5, positive: 0xF0876F, negative: 0x217F7F)
}

struct FuelWidgetSnapshot: Codable, Hashable {
    var updated: Date
    var palette: FuelWidgetPalette

    // Energy
    var consumed: Double?
    var active: Double?
    var resting: Double?
    var burned: Double?
    /// Burned minus consumed. Positive = deficit, matching the "303 kcal deficit" line.
    var deficit: Double?
    var calorieGoal: Double?

    // Nutrition
    var protein: Double?
    var carbs: Double?
    var fat: Double?
    var fiber: Double?
    var proteinGoal: Double?
    var carbsGoal: Double?
    var fatGoal: Double?
    var fiberGoal: Double?
    var entriesLogged: Int?

    // Activity
    var steps: Double?
    var stepGoal: Double?
    var exerciseMinutes: Double?
    var standMinutes: Double?
    var distanceMiles: Double?
    var flightsClimbed: Double?
    var sleepHours: Double?

    // Vitals
    var vitalsScore: Int?
    var vitals: [FuelWidgetVital]

    // History
    var days: [FuelWidgetDay]
    var avgBurned: Double?
    var avgResting: Double?
    var avgActive: Double?
    var avgBalance: Double?

    static let placeholder = FuelWidgetSnapshot(
        updated: Date(timeIntervalSince1970: 0), palette: .fallback,
        consumed: 865, active: 219, resting: 949, burned: 1168, deficit: 303, calorieGoal: 2200,
        protein: 62, carbs: 96, fat: 34, fiber: 12,
        proteinGoal: 150, carbsGoal: 250, fatGoal: 70, fiberGoal: 30, entriesLogged: 3,
        steps: 6420, stepGoal: 10000, exerciseMinutes: 24, standMinutes: 9,
        distanceMiles: 3.1, flightsClimbed: 8, sleepHours: 7.2,
        vitalsScore: 9,
        vitals: [
            FuelWidgetVital(label: "Resting HR", value: 47, unit: "bpm", decimals: 0, center: 47, flagDirection: nil),
            FuelWidgetVital(label: "HRV", value: 101, unit: "ms", decimals: 0, center: 87, flagDirection: nil),
            FuelWidgetVital(label: "Walking HR", value: 78, unit: "bpm", decimals: 0, center: 87, flagDirection: nil),
            FuelWidgetVital(label: "Cardio recovery", value: 44, unit: "bpm", decimals: 0, center: 44, flagDirection: nil),
        ],
        days: [
            FuelWidgetDay(date: "2026-08-09", balance: -820),
            FuelWidgetDay(date: "2026-08-10", balance: 410),
            FuelWidgetDay(date: "2026-08-11", balance: -560),
            FuelWidgetDay(date: "2026-08-12", balance: -303),
        ],
        avgBurned: 2462, avgResting: 1908, avgActive: 554, avgBalance: -132)
}

// MARK: - Shared drawing vocabulary

extension Color {
    init(fuelHex hex: UInt32) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: 1)
    }
}

extension FuelWidgetPalette {
    var accent: Color { Color(fuelHex: primary) }
    var activeColor: Color { Color(fuelHex: secondary) }
    var restingColor: Color { Color(fuelHex: tertiary) }
    var surplusColor: Color { Color(fuelHex: positive) }
    var deficitColor: Color { Color(fuelHex: negative) }
}

enum FuelWidgetFormat {
    static func whole(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        return String(format: "%.0f", value)
    }
    static func grams(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        return String(format: "%.0f", value) + "g"
    }
    static func decimal(_ value: Double?, _ places: Int) -> String {
        guard let value, value.isFinite else { return "—" }
        return String(format: "%.\(places)f", value)
    }
    /// "Mon" for the deficit strip's axis — a widget has no room for a full date.
    static func weekday(_ iso: String) -> String {
        let parser = DateFormatter()
        parser.dateFormat = "yyyy-MM-dd"
        parser.timeZone = .current
        guard let date = parser.date(from: iso) else { return iso }
        let out = DateFormatter()
        out.dateFormat = "EEE"
        return out.string(from: date)
    }
}
