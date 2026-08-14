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
                Group {
                    // A route spanning most of the planet cannot be drawn on a MapKit
                    // view at this size — it will not zoom out that far — so the world
                    // gets drawn flat instead.
                    if journey.spansTheWorld {
                        FlatWorldMap(route: journey.coordinates, laps: laps, animate: shown)
                    } else {
                        JourneyRouteMap(journey: journey, laps: laps, animate: shown)
                    }
                }
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

    /// What the map actually settled on, reported once it has laid out. The route is
    /// projected from this rather than from MapProxy.convert: convert answers nil until
    /// the map has a size, and because this map never moves, nothing ever asked it
    /// again — so most routes drew no line at all while a couple won the timing race.
    @State private var settled: MKMapRect?

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
        GeometryReader { geo in
            let frame = fitted(to: geo.size)
            Map(initialPosition: .rect(frame), interactionModes: []) {
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
            .onMapCameraChange(frequency: .onEnd) { context in settled = context.rect }
            .overlay {
                let rect = settled ?? frame
                let points = journey.coordinates.map { project($0, in: rect, size: geo.size) }
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

    /// Mercator, the same projection the map itself draws in, so a straight line between
    /// two waypoints lands where the map puts them.
    private func project(_ coordinate: CLLocationCoordinate2D, in rect: MKMapRect, size: CGSize) -> CGPoint {
        let point = MKMapPoint(coordinate)
        return CGPoint(x: (point.x - rect.minX) / rect.width * size.width,
                       y: (point.y - rect.minY) / rect.height * size.height)
    }

    /// The route's own bounds, padded, then widened or heightened to the shape of the
    /// card. Matching the aspect ratio is what keeps the drawn line aligned with the map
    /// — and it is what the equator needed: its waypoints span the whole planet in
    /// longitude and nothing at all in latitude, which as a coordinate region asked for a
    /// hundredth of a degree of height and zoomed to a stretch of the South Atlantic.
    private func fitted(to size: CGSize) -> MKMapRect {
        var bounds = MKMapRect.null
        for coordinate in journey.coordinates {
            let point = MKMapPoint(coordinate)
            bounds = bounds.union(MKMapRect(x: point.x, y: point.y, width: 0, height: 0))
        }
        guard !bounds.isNull, size.width > 0, size.height > 0 else {
            return MKMapRect.world
        }
        // A minimum size, so a two-mile swim does not land at street level where the
        // surrounding geography stops being recognisable.
        let floor = MKMapRect.world.width / 4000
        var width = max(bounds.width * 1.5, floor)
        var height = max(bounds.height * 1.5, floor)
        let cardAspect = size.width / size.height
        if width / height < cardAspect { width = height * cardAspect } else { height = width / cardAspect }
        let centreX = bounds.midX, centreY = bounds.midY
        return MKMapRect(x: centreX - width / 2, y: centreY - height / 2, width: width, height: height)
    }
}
