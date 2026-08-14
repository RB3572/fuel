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

    /// Far enough out to see the curve of the planet, and never changed again.
    private static let cameraDistance: CLLocationDistance = 22_000_000
    /// Beyond this the view is looking straight down at a pole, where a map has nothing
    /// left to orient you with.
    private static let maxLatitude = 72.0

    @State private var origin: CLLocationCoordinate2D?
    @State private var originName: String?
    @State private var route: [CLLocationCoordinate2D] = []
    @State private var passes: [Landmark] = []
    @State private var look = CLLocationCoordinate2D(latitude: 20, longitude: 0)
    @State private var camera: MapCameraPosition = .camera(
        MapCamera(centerCoordinate: CLLocationCoordinate2D(latitude: 20, longitude: 0),
                  distance: 22_000_000, heading: 0, pitch: 0))
    @State private var dragAnchor: CLLocationCoordinate2D?
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
        Map(position: $camera, interactionModes: []) {
            if route.count > 1 {
                MapPolyline(coordinates: route)
                    .stroke(DashboardTheme.shared.accent, lineWidth: 3)
            }
            if let origin {
                Annotation("", coordinate: origin) {
                    Circle().fill(DashboardTheme.shared.accent)
                        .frame(width: 13, height: 13)
                        .overlay(Circle().stroke(.white, lineWidth: 2.5))
                }
            }
            ForEach(passes) { landmark in
                Annotation("", coordinate: landmark.coordinate) {
                    Circle().fill(.white)
                        .frame(width: 7, height: 7)
                        .overlay(Circle().stroke(DashboardTheme.shared.accent, lineWidth: 2))
                }
            }
        }
        .mapStyle(.imagery(elevation: .flat))
        .mapControlVisibility(.hidden)
        .clipShape(Circle())
        .overlay(Circle().stroke(Palette.border(scheme), lineWidth: 1))
        .frame(height: 300)
        .padding(.horizontal, 10)
        // The only way the camera ever moves. Degrees per point are tuned so a drag
        // across the globe turns it about that far, which is what makes it feel like a
        // ball rather than a slider.
        .gesture(
            DragGesture()
                .onChanged { value in
                    let anchor = dragAnchor ?? look
                    if dragAnchor == nil { dragAnchor = anchor }
                    let longitude = anchor.longitude - Double(value.translation.width) * 0.32
                    let latitude = anchor.latitude + Double(value.translation.height) * 0.28
                    lookAt(CLLocationCoordinate2D(
                        latitude: min(Self.maxLatitude, max(-Self.maxLatitude, latitude)),
                        longitude: (longitude + 540).truncatingRemainder(dividingBy: 360) - 180))
                }
                .onEnded { _ in dragAnchor = nil }
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

    /// The only writer of the camera, and it only ever changes where it points —
    /// `distance` is the same constant every time, which is what makes zoom impossible
    /// rather than merely disallowed.
    private func lookAt(_ coordinate: CLLocationCoordinate2D) {
        look = coordinate
        camera = .camera(MapCamera(centerCoordinate: coordinate,
                                   distance: Self.cameraDistance, heading: 0, pitch: 0))
    }

    private func start() async {
        guard !started else { return }
        started = true
        let (coordinate, name) = await startingPoint()
        origin = coordinate
        originName = name
        let scenic = Geo.mostScenicBearing(from: coordinate)
        route = Geo.greatCircle(from: coordinate, bearing: scenic.bearing)
        passes = scenic.passes
        lookAt(CLLocationCoordinate2D(latitude: min(Self.maxLatitude, max(-Self.maxLatitude, coordinate.latitude)),
                                      longitude: coordinate.longitude))
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
