import SwiftUI
import MapKit

// One journey, one card: the route where it actually is, with your laps traced along it.
//
// The map is real geography but deliberately inert — no panning, no zooming. It is a
// picture of a place, not somewhere to go exploring, and a map that moves under a finger
// trying to scroll the page is worse than an image.
//
// The line on top is drawn rather than handed to MapKit as an overlay, because the point
// is the animation: MapPolyline can put a static line on a map, but it cannot be traced
// out, and tracing it once per completed lap in a colour that walks from green to red is
// the whole idea. MapReader projects each coordinate into view space, so the drawn line
// sits exactly where the real route does.

struct JourneyMapCard: View {
    @Environment(\.colorScheme) private var scheme
    let journey: Journey
    /// How far along, or how many times over.
    let laps: Double
    let milesCovered: Double

    @State private var shown = false

    private var isComplete: Bool { laps >= 1 }

    var body: some View {
        Panel {
            VStack(alignment: .leading, spacing: 10) {
                header
                JourneyRouteMap(journey: journey, laps: laps, animate: shown)
                    .frame(height: 168)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Palette.border(scheme), lineWidth: 1))
                footer
            }
        }
        .onScrollVisibilityChange { visible in if visible { shown = true } }
    }

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(journey.name).font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(Palette.ink(scheme))
                Text(journey.detail).font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
            }
            Spacer()
            Text(badge)
                .font(.system(size: 12, weight: .semibold))
                .padding(.horizontal, 9).padding(.vertical, 4)
                .background(Capsule().fill(badgeTint.opacity(0.16)))
                .foregroundStyle(badgeTint)
        }
    }

    private var badge: String {
        if !isComplete { return "\(Int(laps * 100))%" }
        if laps >= 10 { return "\(Int(laps.rounded(.down)))× over" }
        if laps >= 2 { return String(format: "%.1f× over", laps) }
        return "Done"
    }

    private var badgeTint: Color { isComplete ? .green : DashboardTheme.shared.accent }

    private var footer: some View {
        Text(isComplete
             ? "\(Format.number(journey.miles)) miles · \(journey.source)"
             : "\(Format.number(journey.miles - milesCovered)) miles to go · \(journey.source)")
            .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
    }
}

/// The map and the traced route. Split out so the card above stays about layout.
struct JourneyRouteMap: View {
    @Environment(\.colorScheme) private var scheme
    let journey: Journey
    let laps: Double
    let animate: Bool

    /// Beyond this the lines stop being distinguishable and start being a smear; the
    /// count is stated in the badge, so nothing is lost by capping the drawing.
    private static let maxDrawnLaps = 6

    private var drawn: Int { min(Self.maxDrawnLaps, max(1, Int(laps.rounded(.up)))) }

    /// Green for the first lap through to red for the last.
    private func colour(_ index: Int) -> Color {
        guard drawn > 1 else { return Color(hue: 0.33, saturation: 0.75, brightness: 0.72) }
        let t = Double(index) / Double(drawn - 1)
        return Color(hue: 0.33 * (1 - t), saturation: 0.82, brightness: 0.80)
    }

    private func portion(_ index: Int) -> Double { max(0, min(1, laps - Double(index))) }

    var body: some View {
        MapReader { proxy in
            Map(initialPosition: .region(region), interactionModes: []) {
                // Endpoints, so a route reads as going from somewhere to somewhere.
                if let first = journey.coordinates.first {
                    Annotation("", coordinate: first) { endpoint }
                }
                if let last = journey.coordinates.last, journey.coordinates.count > 1 {
                    Annotation("", coordinate: last) { endpoint }
                }
            }
            .mapStyle(.standard(elevation: .flat, pointsOfInterest: .excludingAll))
            .mapControlVisibility(.hidden)
            .allowsHitTesting(false)
            .overlay {
                // Projected into view space by the map itself, so the drawn line lands
                // exactly on the geography underneath it.
                let points = journey.coordinates.compactMap { proxy.convert($0, to: .local) }
                if points.count > 1 {
                    ZStack {
                        routePath(points)
                            .stroke(Palette.ink(scheme).opacity(0.25),
                                    style: StrokeStyle(lineWidth: 3.5, lineCap: .round, lineJoin: .round, dash: [4, 5]))
                        ForEach(0..<drawn, id: \.self) { index in
                            routePath(points)
                                .trim(from: 0, to: animate ? portion(index) : 0)
                                .stroke(colour(index),
                                        style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                                .animation(.easeInOut(duration: 0.8).delay(Double(index) * 0.18), value: animate)
                        }
                    }
                }
            }
        }
    }

    private var endpoint: some View {
        Circle()
            .fill(Palette.panel(scheme))
            .frame(width: 9, height: 9)
            .overlay(Circle().stroke(Palette.ink(scheme).opacity(0.55), lineWidth: 2))
    }

    private func routePath(_ points: [CGPoint]) -> Path {
        var path = Path()
        path.move(to: points[0])
        for point in points.dropFirst() { path.addLine(to: point) }
        return path
    }

    /// Framed on the route with a margin, so a line never runs into the edge.
    private var region: MKCoordinateRegion {
        let coordinates = journey.coordinates
        guard let first = coordinates.first else {
            return MKCoordinateRegion(center: .init(latitude: 0, longitude: 0),
                                      span: .init(latitudeDelta: 120, longitudeDelta: 240))
        }
        var minLat = first.latitude, maxLat = first.latitude
        var minLon = first.longitude, maxLon = first.longitude
        for point in coordinates {
            minLat = min(minLat, point.latitude); maxLat = max(maxLat, point.latitude)
            minLon = min(minLon, point.longitude); maxLon = max(maxLon, point.longitude)
        }
        let centre = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLon + maxLon) / 2)
        // A floor on the span keeps a two-mile swim from zooming to street level, where
        // the surrounding geography stops being recognisable.
        // Clamped at both ends: a two-mile swim must not zoom to street level, and the
        // equator's own 360° of longitude must not ask for more world than exists.
        let span = MKCoordinateSpan(
            latitudeDelta: min(170, max(0.08, (maxLat - minLat) * 1.6)),
            longitudeDelta: min(350, max(0.08, (maxLon - minLon) * 1.6)))
        return MKCoordinateRegion(center: centre, span: span)
    }
}
