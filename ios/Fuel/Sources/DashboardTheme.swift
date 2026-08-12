import SwiftUI
import UIKit

// User-customizable accent colors for the whole app. `accent` replaces what used to be
// the hardcoded flame orange everywhere it was a UI accent — tab tint, Coach bubbles,
// goal bars, buttons — while `secondary`/`tertiary` carry the active/resting energy
// hues and `positive`/`negative` the surplus/deficit bars. Palette.flame* survives only
// where the colour is the Fuel brand rather than a theme choice: the launch screen mark
// and the app icon, which must keep matching the icon on the Home Screen.

struct DashboardPalette: Identifiable, Equatable {
    var id: String { name }
    var name: String
    var primary: UInt32
    var secondary: UInt32
    var tertiary: UInt32
    /// Surplus (ate more than burned) and deficit (burned more than ate). Separate from
    /// `primary` because sign carries meaning here: the website reads these as two
    /// opposed colours, so one accent used for both would throw away that signal.
    var positive: UInt32
    var negative: UInt32

    static let presets: [DashboardPalette] = [
        // The default, and what fuel.rishib.com uses: teal burn, coral active, amber
        // intake. First in the list because it is what a fresh install gets.
        DashboardPalette(name: "Default", primary: 0x2C7A7B, secondary: 0xE8674C, tertiary: 0x4FD1C5,
                          positive: 0xF0876F, negative: 0x217F7F),
        DashboardPalette(name: "Flame", primary: 0xF2531B, secondary: 0xEF8F4D, tertiary: 0x7D8FA3,
                          positive: 0xF2531B, negative: 0x3F5A70),
        DashboardPalette(name: "Ocean", primary: 0x1B6FF2, secondary: 0x35B4E0, tertiary: 0x7D93A8,
                          positive: 0xE0603F, negative: 0x1B6FF2),
        DashboardPalette(name: "Forest", primary: 0x1E8F4E, secondary: 0x8FBF3F, tertiary: 0x8FA391,
                          positive: 0xD9541E, negative: 0x1E8F4E),
        DashboardPalette(name: "Berry", primary: 0xC0208A, secondary: 0xE0708F, tertiary: 0x9E8AA3,
                          positive: 0xC0208A, negative: 0x5B4B8A),
        DashboardPalette(name: "Slate", primary: 0x3F3F3F, secondary: 0x8A8A85, tertiary: 0xB5B5B0,
                          positive: 0x6E6E6E, negative: 0x2A2A2A),
    ]
}

@MainActor
@Observable
final class DashboardTheme {
    static let shared = DashboardTheme()

    private(set) var primary: Color
    private(set) var secondary: Color
    private(set) var tertiary: Color
    private(set) var positive: Color
    private(set) var negative: Color
    /// The matching preset's name, or nil once any one color has been hand-picked — so
    /// the presets list can show which one (if any) is currently active.
    private(set) var activePresetName: String?

    /// The app-wide accent: tab tint, Coach bubbles, goal bars, buttons. Everything
    /// that used to be hardcoded to the flame orange reads this instead, so choosing a
    /// palette re-themes the whole app rather than just the Today charts.
    var accent: Color { primary }

    func apply(_ preset: DashboardPalette) {
        primary = Color(hex: preset.primary)
        secondary = Color(hex: preset.secondary)
        tertiary = Color(hex: preset.tertiary)
        positive = Color(hex: preset.positive)
        negative = Color(hex: preset.negative)
        activePresetName = preset.name
        persist()
    }

    func setPrimary(_ color: Color) { primary = color; activePresetName = nil; persist() }
    func setSecondary(_ color: Color) { secondary = color; activePresetName = nil; persist() }
    func setTertiary(_ color: Color) { tertiary = color; activePresetName = nil; persist() }
    func setPositive(_ color: Color) { positive = color; activePresetName = nil; persist() }
    func setNegative(_ color: Color) { negative = color; activePresetName = nil; persist() }

    private init() {
        let d = UserDefaults.standard
        let fallback = DashboardPalette.presets[0]
        func stored(_ key: String, _ fallbackHex: UInt32) -> Color {
            Color(hex: d.string(forKey: key).flatMap { UInt32($0, radix: 16) } ?? fallbackHex)
        }
        primary = stored("fuelDashPrimary", fallback.primary)
        secondary = stored("fuelDashSecondary", fallback.secondary)
        tertiary = stored("fuelDashTertiary", fallback.tertiary)
        positive = stored("fuelDashPositive", fallback.positive)
        negative = stored("fuelDashNegative", fallback.negative)
        // This palette shipped as "Website" before it became the default. Anyone who
        // had picked it keeps their checkmark instead of the list looking unselected.
        let savedName = d.string(forKey: "fuelDashPresetName")
        activePresetName = savedName == "Website" ? fallback.name : (savedName ?? fallback.name)
    }

    private func persist() {
        let d = UserDefaults.standard
        d.set(primary.hexString, forKey: "fuelDashPrimary")
        d.set(secondary.hexString, forKey: "fuelDashSecondary")
        d.set(tertiary.hexString, forKey: "fuelDashTertiary")
        d.set(positive.hexString, forKey: "fuelDashPositive")
        d.set(negative.hexString, forKey: "fuelDashNegative")
        if let name = activePresetName { d.set(name, forKey: "fuelDashPresetName") }
        else { d.removeObject(forKey: "fuelDashPresetName") }
    }
}

extension Color {
    var hexString: String {
        let c = UIColor(self)
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        c.getRed(&r, green: &g, blue: &b, alpha: &a)
        return String(format: "%02X%02X%02X", Int((r * 255).rounded()), Int((g * 255).rounded()), Int((b * 255).rounded()))
    }
}

// MARK: - Picker sheet

struct DashboardColorsSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    @Bindable private var theme = DashboardTheme.shared

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ForEach(DashboardPalette.presets) { preset in
                        Button {
                            theme.apply(preset)
                        } label: {
                            HStack(spacing: 12) {
                                HStack(spacing: 4) {
                                    ForEach(Array([preset.primary, preset.secondary, preset.tertiary,
                                                   preset.positive, preset.negative].enumerated()), id: \.offset) { _, hex in
                                        Circle().fill(Color(hex: hex)).frame(width: 16, height: 16)
                                    }
                                }
                                Text(preset.name).foregroundStyle(Palette.ink(scheme))
                                Spacer()
                                if theme.activePresetName == preset.name {
                                    Image(systemName: "checkmark").foregroundStyle(theme.accent)
                                }
                            }
                        }
                    }
                } header: {
                    Text("Presets")
                }
                Section {
                    ColorPicker("Accent", selection: Binding(
                        get: { theme.primary }, set: { theme.setPrimary($0) }))
                    ColorPicker("Active energy", selection: Binding(
                        get: { theme.secondary }, set: { theme.setSecondary($0) }))
                    ColorPicker("Resting energy", selection: Binding(
                        get: { theme.tertiary }, set: { theme.setTertiary($0) }))
                } header: {
                    Text("Custom")
                } footer: {
                    Text("The accent colors the whole app — tabs, buttons, the Coach, and charts. Picking any color here switches off the preset above.")
                }

                Section {
                    ColorPicker("Surplus (ate more)", selection: Binding(
                        get: { theme.positive }, set: { theme.setPositive($0) }))
                    ColorPicker("Deficit (burned more)", selection: Binding(
                        get: { theme.negative }, set: { theme.setNegative($0) }))
                } header: {
                    Text("Daily deficit and surplus")
                } footer: {
                    Text("The two bar colors on the daily deficit and surplus chart, above and below the zero line.")
                }
            }
            .navigationTitle("Dashboard colors")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }
}
