import SwiftUI

// The web app's design tokens, transcribed. Fuel on the web is deliberately
// monochrome — warm off-white paper, near-black ink, one weight of emphasis — and the
// phone app should look like the same product, not a themed cousin. Values come
// straight from src/index.css.

enum Palette {
    static let background = Color(hex: 0xF7F7F5)
    static let panel = Color(hex: 0xFFFFFF)
    static let surface = Color(hex: 0xF3F3F1)
    static let surfaceHover = Color(hex: 0xECECEA)
    static let ink = Color(hex: 0x111111)
    static let muted = Color(hex: 0x747474)
    static let mutedStrong = Color(hex: 0x3F3F3F)
    static let border = Color(hex: 0xDEDEDB)
    static let borderSoft = Color(hex: 0xECECEA)
    static let accentSoft = Color(hex: 0xA8A8A3)

    // Dark mode is not in the web app's stylesheet, so these are derived: the same
    // relationships inverted, rather than invented colours.
    static func background(_ scheme: ColorScheme) -> Color { scheme == .dark ? Color(hex: 0x0E0E0D) : background }
    static func panel(_ scheme: ColorScheme) -> Color { scheme == .dark ? Color(hex: 0x1A1A18) : panel }
    static func surface(_ scheme: ColorScheme) -> Color { scheme == .dark ? Color(hex: 0x232320) : surface }
    static func ink(_ scheme: ColorScheme) -> Color { scheme == .dark ? Color(hex: 0xF2F2EF) : ink }
    static func muted(_ scheme: ColorScheme) -> Color { scheme == .dark ? Color(hex: 0x9A9A95) : muted }
    static func border(_ scheme: ColorScheme) -> Color { scheme == .dark ? Color(hex: 0x2E2E2A) : border }

    /// The one place colour is allowed, matching the app icon.
    static let flameTop = Color(hex: 0xBD140B)
    static let flameMid = Color(hex: 0xF2531B)
    static let flameBottom = Color(hex: 0xFFAA21)
    static var flame: LinearGradient {
        LinearGradient(colors: [flameTop, flameMid, flameBottom], startPoint: .top, endPoint: .bottom)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: 1)
    }
}

// MARK: - Panels

/// The web app's `.panel`: white card, hairline border, generous radius. Everything on
/// the dashboard sits in one.
struct Panel<Content: View>: View {
    @Environment(\.colorScheme) private var scheme
    var title: String?
    var subtitle: String?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 13, weight: .semibold))
                        .textCase(.uppercase)
                        .kerning(0.6)
                        .foregroundStyle(Palette.muted(scheme))
                    if let subtitle {
                        Text(subtitle).font(.system(size: 13)).foregroundStyle(Palette.muted(scheme))
                    }
                }
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Palette.panel(scheme))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Palette.border(scheme), lineWidth: 1)
        )
    }
}

/// A big number with its label, the dashboard's basic unit.
struct Stat: View {
    @Environment(\.colorScheme) private var scheme
    let label: String
    let value: String
    var detail: String?
    /// Overrides the value's colour when the number itself carries meaning — a surplus
    /// versus a deficit, say. Nil keeps the default ink so ordinary stats stay uniform.
    var tint: Color?

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Palette.muted(scheme))
            Text(value)
                .font(.system(size: 26, weight: .semibold, design: .rounded))
                .foregroundStyle(tint ?? Palette.ink(scheme))
                .contentTransition(.numericText())
            if let detail {
                Text(detail).font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Progress toward a goal, drawn the way the web app draws its goal bars.
struct GoalBar: View {
    @Environment(\.colorScheme) private var scheme
    let label: String
    let value: Double?
    let target: Double?
    var unit: String = ""

    private var fraction: Double {
        guard let value, let target, target > 0 else { return 0 }
        return min(1.4, value / target)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.ink(scheme))
                Spacer()
                Text(value == nil ? "—" : "\(Format.number(value)) / \(Format.number(target))\(unit)")
                    .font(.system(size: 12, design: .rounded))
                    .foregroundStyle(Palette.muted(scheme))
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Palette.surface(scheme))
                    Capsule()
                        .fill(fraction > 1.05 ? AnyShapeStyle(DashboardTheme.shared.accent) : AnyShapeStyle(Palette.ink(scheme)))
                        .frame(width: max(2, geo.size.width * min(1, fraction)))
                }
            }
            .frame(height: 6)
        }
    }
}

enum Format {
    static func number(_ value: Double?, decimals: Int = 0) -> String {
        guard let value, value.isFinite else { return "—" }
        return String(format: "%.\(decimals)f", value)
    }

    static func kcal(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        return String(format: "%.0f", value)
    }
}
