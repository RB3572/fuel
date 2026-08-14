import SwiftUI
import MapKit
import CoreLocation

// A globe you spin with a finger, with one lap of the planet drawn on its surface.
//
// The map has no interaction of its own — `interactionModes: []` — and the camera is
// driven entirely from a drag that changes only the point being looked at. Distance is a
// constant, so zooming is not something the user has to be prevented from doing; it is
// not expressible. That also removes the pole behaviour, where MapKit's own gesture
// handling pulled the camera in as it approached 90°.
//
// The line is a real great circle: one full lap, 24,901 miles, starting where you are.
// Which lap is not arbitrary — of all the circles through your location, it draws the one
// that passes nearest the most famous places, which is what makes it worth spinning.

struct GlobeView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme

    let fraction: Double
    let miles: Double

    /// The last resort. A named place rather than 0°/0°, which is a spot in the Atlantic
    /// and tells you nothing.
    static let fallback = CLLocationCoordinate2D(latitude: 44.9537, longitude: -93.0900)
    static let fallbackName = "St. Paul, Minnesota"

    @State private var origin: CLLocationCoordinate2D?
    @State private var originName: String?
    @State private var route: [CLLocationCoordinate2D] = []
    @State private var passes: [Landmark] = []
    /// Where the viewer is over. There is no distance to change, so there is nothing to
    /// zoom — the sphere is always drawn to the width of its frame.
    @State private var centreLat = 20.0
    @State private var centreLon = 0.0
    @State private var anchor: (lat: Double, lon: Double)?
    @State private var started = false

    var body: some View {
        VStack(spacing: 12) {
            globe
            summary
            if !passes.isEmpty { landmarkList }
        }
        .task { await start() }
    }

    private var globe: some View {
        GlobeSphere(route: route, origin: origin, landmarks: Array(passes.prefix(10)),
                    centreLat: centreLat, centreLon: centreLon)
            .frame(height: 300)
            .padding(.horizontal, 10)
            // The whole interaction. Two numbers change and the next frame is a Canvas
            // pass over a few hundred points, so this keeps up with a finger.
            .gesture(
                DragGesture()
                    .onChanged { value in
                        if anchor == nil { anchor = (centreLat, centreLon) }
                        guard let anchor else { return }
                        centreLon = wrapped(anchor.lon - Double(value.translation.width) * 0.35)
                        // Clamped short of the poles: past about 80° the grid converges
                        // to a point and turning stops reading as turning.
                        centreLat = min(80, max(-80, anchor.lat + Double(value.translation.height) * 0.3))
                    }
                    .onEnded { _ in anchor = nil }
            )
    }

    private var summary: some View {
        VStack(spacing: 3) {
            Text(Format.number(miles) + " miles")
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .foregroundStyle(Palette.ink(scheme))
            Text(fraction >= 1
                 ? String(format: "%.2f times around the equator", fraction)
                 : String(format: "%.1f%% of one lap of the planet", fraction * 100))
                .font(.system(size: 13)).foregroundStyle(Palette.muted(scheme))
            if let originName {
                Label("Starting from \(originName)", systemImage: "mappin.and.ellipse")
                    .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                    .padding(.top, 2)
            }
            Text("Drag to spin the globe.")
                .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
        }
    }

    /// What the drawn lap actually runs past, nearest first.
    private var landmarkList: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("This lap runs past")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Palette.muted(scheme))
                .padding(.bottom, 6)
            ForEach(Array(passes.prefix(6).enumerated()), id: \.element.id) { index, landmark in
                if let origin {
                    let away = Geo.distance(origin, landmark.coordinate)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("You are \(Format.number(away)) miles from \(landmark.name)")
                            .font(.system(size: 13)).foregroundStyle(Palette.ink(scheme))
                        Text(landmark.quip)
                            .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 5)
                    if index < min(6, passes.count) - 1 { Divider().opacity(0.35) }
                }
            }
        }
    }

    private func wrapped(_ longitude: Double) -> Double {
        (longitude + 540).truncatingRemainder(dividingBy: 360) - 180
    }

    private func start() async {
        guard !started else { return }
        started = true
        let (coordinate, name) = await startingPoint()
        origin = coordinate
        originName = name
        let scenic = Geo.mostScenicBearing(from: coordinate)
        // 96 segments is smooth at this size and two-fifths the geometry of 180 —
        // the polyline is re-projected on every frame the globe turns.
        route = Geo.greatCircle(from: coordinate, bearing: scenic.bearing, steps: 96)
        passes = scenic.passes
        centreLat = min(80, max(-80, coordinate.latitude))
        centreLon = coordinate.longitude
        if name == nil { originName = await reverseGeocode(coordinate) }
    }

    /// Most-lived-in place, then the current fix, then the fallback.
    private func startingPoint() async -> (CLLocationCoordinate2D, String?) {
        if store.places == nil { store.places = try? await store.placesForGlobe() }
        if let best = store.places?.places.max(by: { $0.samples < $1.samples }) {
            return (CLLocationCoordinate2D(latitude: best.latitude, longitude: best.longitude),
                    best.label ?? best.suggestedLabel)
        }
        if let fix = await LocationSampler.shared.fixForLogging() {
            return (CLLocationCoordinate2D(latitude: fix.latitude, longitude: fix.longitude), nil)
        }
        return (Self.fallback, Self.fallbackName)
    }

    /// MKReverseGeocodingRequest rather than CLGeocoder, which is deprecated as of iOS 26.
    private func reverseGeocode(_ coordinate: CLLocationCoordinate2D) async -> String? {
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        guard let request = MKReverseGeocodingRequest(location: location),
              let item = try? await request.mapItems.first else { return nil }
        return item.name ?? item.address?.shortAddress
    }
}
