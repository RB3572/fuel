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
    /// Each landmark's place along the lap, 0–1. Worked out once when the route is built:
    /// it is a search over every point of the route, and the globe redraws sixty times a
    /// second.
    @State private var passPositions: [(landmark: Landmark, along: Double)] = []
    /// Where the viewer was over when the current glide began. There is no distance to
    /// change, so there is nothing to zoom — the sphere is always drawn to the width of
    /// its frame.
    @State private var baseLat = 20.0
    @State private var baseLon = 0.0
    /// The throw, in degrees a second, and when it was let go of. Between them these give
    /// the position at any moment in closed form, so spinning costs no per-frame state.
    @State private var spinLat = 0.0
    @State private var spinLon = 0.0
    @State private var releasedAt = Date()
    @State private var anchor: (lat: Double, lon: Double)?
    @State private var started = false

    /// Left alone it turns eastward, the way the planet does, once every two minutes.
    private static let idleSpin = 3.0
    /// How quickly a throw gives way to that drift. About a second of glide.
    private static let friction = 0.9

    var body: some View {
        VStack(spacing: 12) {
            globe
            summary
            if !passes.isEmpty { landmarkList }
        }
        .task { await start() }
    }

    private var globe: some View {
        // Driven from the clock rather than a timer writing state sixty times a second:
        // both the glide after a throw and the idle drift have closed forms, so each
        // frame asks where the globe is now instead of being told.
        // Capped at sixty a second rather than left to the display: a globe drifting three
        // degrees a second looks no different at 120, and it is a Canvas pass either way.
        TimelineView(.animation(minimumInterval: 1.0 / 60, paused: anchor != nil)) { timeline in
            let centre = centre(at: timeline.date)
            GlobeSphere(route: route, progress: progress, origin: origin, here: here,
                        landmarks: Array(passes.prefix(10)), highlight: nextLandmark,
                        centreLat: centre.lat, centreLon: centre.lon)
        }
        .frame(height: 300)
        .padding(.horizontal, 10)
        // The whole interaction. Two numbers change and the next frame is a Canvas pass
        // over a couple of thousand points, so this keeps up with a finger.
        .gesture(
            DragGesture()
                .onChanged { value in
                    if anchor == nil {
                        // Catch the globe where it has drifted to, not where it was let
                        // go of, or grabbing a spinning planet would jump it.
                        let centre = centre(at: Date())
                        baseLat = centre.lat
                        baseLon = centre.lon
                        anchor = (baseLat, baseLon)
                    }
                    guard let anchor else { return }
                    baseLon = wrapped(anchor.lon - Double(value.translation.width) * 0.35)
                    // Clamped short of the poles: past about 80° the sphere converges to
                    // a point and turning stops reading as turning.
                    baseLat = min(80, max(-80, anchor.lat + Double(value.translation.height) * 0.3))
                }
                .onEnded { value in
                    // The same scale the drag itself uses, so the globe leaves your
                    // finger at exactly the speed your finger was moving.
                    spinLon = max(-400, min(400, -Double(value.velocity.width) * 0.35))
                    spinLat = max(-300, min(300, Double(value.velocity.height) * 0.3))
                    releasedAt = Date()
                    anchor = nil
                }
        )
    }

    /// Where the globe is at a given moment.
    ///
    /// Longitude eases from the speed it was thrown at down to the idle drift, latitude
    /// from its throw to a stop; both are the integral of an exponential decay, which is
    /// why this can be a function of the time rather than a running total.
    private func centre(at date: Date) -> (lat: Double, lon: Double) {
        guard anchor == nil else { return (baseLat, baseLon) }
        let elapsed = max(0, date.timeIntervalSince(releasedAt))
        let spent = 1 - exp(-elapsed / Self.friction)
        let longitude = baseLon + Self.idleSpin * elapsed
            + (spinLon - Self.idleSpin) * Self.friction * spent
        let latitude = baseLat + spinLat * Self.friction * spent
        return (min(80, max(-80, latitude)), wrapped(longitude))
    }

    /// How far round the lap you are. Past one full lap it wraps — you are round again.
    private var progress: Double {
        guard fraction > 0 else { return 0 }
        return fraction < 1 ? fraction : fraction.truncatingRemainder(dividingBy: 1)
    }

    /// Where that leaves you on the drawn line.
    private var here: CLLocationCoordinate2D? {
        guard route.count > 1 else { return nil }
        let step = Int((Double(route.count - 1) * progress).rounded())
        return route[min(route.count - 1, max(0, step))]
    }

    /// The landmark you reach next, going forward from where you are — not the nearest
    /// one, which may well be one you passed a thousand miles ago.
    private var nextLandmark: Landmark? {
        passPositions
            .min { ahead($0.along) < ahead($1.along) }?
            .landmark
    }

    private func ahead(_ along: Double) -> Double {
        (along - progress + 1).truncatingRemainder(dividingBy: 1)
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
            // The aside belongs to one place at a time — the one you are about to reach.
            // Printed against all six of them it was six jokes nobody was reading.
            if let next = nextLandmark {
                VStack(spacing: 2) {
                    Text("Coming up: \(next.name)")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(DashboardTheme.shared.accent)
                    Text(next.quip)
                        .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                        .multilineTextAlignment(.center)
                }
                .padding(.top, 6)
            }
            Text("Spin it with a finger, or let it turn.")
                .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                .padding(.top, 4)
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
                    Text("You are \(Format.number(away)) miles from \(landmark.name)")
                        .font(.system(size: 13))
                        .foregroundStyle(landmark == nextLandmark
                                         ? DashboardTheme.shared.accent : Palette.ink(scheme))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 6)
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
        passPositions = scenic.passes.map { landmark in
            // Where it sits along the drawn line: the nearest point of the route to it,
            // as a fraction of the way round.
            var nearest = 0
            var best = Double.greatestFiniteMagnitude
            for (step, point) in route.enumerated() {
                let away = Geo.distance(point, landmark.coordinate)
                if away < best { best = away; nearest = step }
            }
            return (landmark, Double(nearest) / Double(max(1, route.count - 1)))
        }
        baseLat = min(80, max(-80, coordinate.latitude))
        baseLon = coordinate.longitude
        releasedAt = Date()
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
