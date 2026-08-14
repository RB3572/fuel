import SwiftUI

// The picture behind each journey: a stylised route drawn as a path, with your own laps
// traced along it one after another.
//
// These are gestures, not cartography — a crossing, a ridge line, a crenellated wall —
// chosen so that a channel swim and a mountain trail do not get the same picture. The
// point is the tracing: each completed lap draws its own line along the route, and the
// laps run green through amber to red as they pile up, so ten times over reads as ten
// times over at a glance.

struct JourneyRoute: Shape {
    let kind: JourneyShape

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let w = rect.width, h = rect.height
        func p(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: rect.minX + w * x, y: rect.minY + h * y) }

        switch kind {
        case .crossing:
            // Shore to shore, bowing with the current.
            path.move(to: p(0.04, 0.72))
            path.addCurve(to: p(0.96, 0.30), control1: p(0.34, 0.94), control2: p(0.66, 0.10))

        case .trail:
            // A ridge line: up over the passes and down into the valleys.
            path.move(to: p(0.03, 0.82))
            for (index, peak) in [0.30, 0.55, 0.34, 0.68, 0.26].enumerated() {
                let x = 0.03 + Double(index + 1) * (0.94 / 5)
                path.addLine(to: p(x - 0.09, peak))
                path.addLine(to: p(x, peak + 0.22))
            }

        case .wall:
            // Crenellations along a wall that climbs as it goes.
            path.move(to: p(0.03, 0.80))
            var x = 0.03
            var base = 0.80
            while x < 0.92 {
                path.addLine(to: p(x, base - 0.20))
                path.addLine(to: p(x + 0.055, base - 0.20))
                path.addLine(to: p(x + 0.055, base))
                path.addLine(to: p(x + 0.11, base))
                x += 0.11
                base -= 0.035
            }

        case .river:
            // A meander, wide then tight.
            path.move(to: p(0.04, 0.30))
            path.addCurve(to: p(0.36, 0.62), control1: p(0.16, 0.28), control2: p(0.22, 0.66))
            path.addCurve(to: p(0.64, 0.36), control1: p(0.50, 0.58), control2: p(0.52, 0.32))
            path.addCurve(to: p(0.96, 0.74), control1: p(0.78, 0.40), control2: p(0.82, 0.76))

        case .loop:
            // A circuit that comes back to where it started.
            path.addEllipse(in: CGRect(x: rect.minX + w * 0.18, y: rect.minY + h * 0.12,
                                       width: w * 0.64, height: h * 0.76))

        case .coast:
            // A long shoreline, headlands and bays.
            path.move(to: p(0.06, 0.10))
            path.addCurve(to: p(0.40, 0.44), control1: p(0.22, 0.18), control2: p(0.24, 0.40))
            path.addCurve(to: p(0.58, 0.60), control1: p(0.52, 0.47), control2: p(0.48, 0.60))
            path.addCurve(to: p(0.90, 0.92), control1: p(0.74, 0.60), control2: p(0.76, 0.86))

        case .road:
            // Straight, with the gentle drift a long highway has.
            path.move(to: p(0.03, 0.66))
            path.addCurve(to: p(0.97, 0.40), control1: p(0.36, 0.60), control2: p(0.62, 0.46))

        case .equator:
            // The circle itself.
            let side = min(w, h) * 0.82
            path.addEllipse(in: CGRect(x: rect.midX - side / 2, y: rect.midY - side / 2,
                                       width: side, height: side))
        }
        return path
    }
}

/// The route with your laps traced along it. Each lap is its own stroke, drawn in turn,
/// coloured by how far into the pile it is: the first is green, the last is red.
struct JourneyArtwork: View {
    @Environment(\.colorScheme) private var scheme
    let journey: Journey
    /// How many times over the distance has been covered. Fractions draw a partial lap,
    /// which is what makes a journey you are halfway through look halfway through.
    let laps: Double
    /// Set when the card is on screen. Left false, nothing is drawn — that is what makes
    /// the lines appear to run as you scroll past rather than being there already.
    let animate: Bool

    /// Beyond this the lines stop being distinguishable and start being a smear. The
    /// count is stated in words next to the picture, so nothing is lost by capping it.
    private static let maxDrawnLaps = 8

    private var drawn: Int { min(Self.maxDrawnLaps, max(1, Int(laps.rounded(.up)))) }

    /// Green for the first lap through to red for the last — a single hue ramp, so the
    /// order is readable even though the lines sit on top of one another.
    private func colour(_ index: Int) -> Color {
        guard drawn > 1 else { return Color(hue: 0.33, saturation: 0.75, brightness: 0.72) }
        let t = Double(index) / Double(drawn - 1)
        // 0.33 is green, 0.0 is red; going down through amber rather than up through
        // blue keeps it a single warm-to-cool ramp.
        return Color(hue: 0.33 * (1 - t), saturation: 0.78, brightness: 0.78)
    }

    private func portion(_ index: Int) -> Double {
        let remaining = laps - Double(index)
        return max(0, min(1, remaining))
    }

    var body: some View {
        ZStack {
            JourneyRoute(kind: journey.shape)
                .stroke(Palette.border(scheme), style: StrokeStyle(lineWidth: 2, lineCap: .round, dash: [3, 4]))

            ForEach(0..<drawn, id: \.self) { index in
                JourneyRoute(kind: journey.shape)
                    .trim(from: 0, to: animate ? portion(index) : 0)
                    .stroke(colour(index),
                            style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                    .animation(.easeInOut(duration: 0.7).delay(Double(index) * 0.16), value: animate)
            }
        }
        .frame(height: 78)
        .padding(.vertical, 2)
        .accessibilityHidden(true)
    }
}
