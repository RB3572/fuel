import SwiftUI
import MapKit
import CoreLocation

// A real globe, not a drawing of one: Apple's satellite imagery on a sphere you can spin
// with a finger. Circular by design — the point is that it is the Earth, and your
// distance is a share of the way around it.
//
// Where it starts matters. Somebody's own map should open where they actually are, so it
// tries their most-lived-in place first, then wherever the phone says they are now, and
// only then falls back to a fixed point so that a brand-new account still gets a globe
// rather than the middle of the Atlantic.

struct GlobeView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme

    /// Progress around the equator, drawn as a ring outside the globe.
    let fraction: Double
    let miles: Double

    /// The last resort. A named place, not 0°/0°, because an ocean says nothing.
    static let fallback = CLLocationCoordinate2D(latitude: 44.9537, longitude: -93.0900)
    static let fallbackName = "St. Paul, Minnesota"

    @State private var camera: MapCameraPosition = .automatic
    @State private var centre: CLLocationCoordinate2D?
    @State private var placeName: String?
    @State private var started = false

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Map(position: $camera, interactionModes: [.pan, .rotate, .zoom]) {
                    if let centre {
                        Annotation("", coordinate: centre) {
                            Circle()
                                .fill(DashboardTheme.shared.accent)
                                .frame(width: 12, height: 12)
                                .overlay(Circle().stroke(.white, lineWidth: 2))
                        }
                    }
                }
                // Satellite imagery with real elevation: zoomed this far out it is the
                // planet, which is the whole idea.
                .mapStyle(.imagery(elevation: .realistic))
                .mapControlVisibility(.hidden)
                .clipShape(Circle())
                .overlay(Circle().stroke(Palette.border(scheme), lineWidth: 1))

                // The lap ring, drawn outside the globe so it never obscures it.
                Circle()
                    .trim(from: 0, to: max(0.001, min(1, fraction.truncatingRemainder(dividingBy: 1))))
                    .stroke(DashboardTheme.shared.accent,
                            style: StrokeStyle(lineWidth: 6, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .padding(-11)
            }
            .frame(height: 260)
            .padding(.horizontal, 14)

            VStack(spacing: 3) {
                Text(Format.number(miles) + " miles")
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .foregroundStyle(Palette.ink(scheme))
                Text(fraction >= 1
                     ? String(format: "%.2f times around the equator", fraction)
                     : String(format: "%.1f%% of the way around the equator", fraction * 100))
                    .font(.system(size: 13)).foregroundStyle(Palette.muted(scheme))
                if let placeName {
                    Label("Centred on \(placeName)", systemImage: "mappin.and.ellipse")
                        .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                        .padding(.top, 2)
                }
                Text("Drag to spin it.")
                    .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
            }
        }
        .task { await start() }
    }

    private func start() async {
        guard !started else { return }
        started = true
        let (coordinate, name) = await startingPoint()
        centre = coordinate
        placeName = name
        // Far enough out that the horizon curves — a globe rather than a map of a city.
        camera = .camera(MapCamera(centerCoordinate: coordinate, distance: 16_000_000, heading: 0, pitch: 0))
        if name == nil { placeName = await reverseGeocode(coordinate) }
    }

    /// Most-lived-in place, then the current fix, then the fallback.
    private func startingPoint() async -> (CLLocationCoordinate2D, String?) {
        if store.places == nil { store.places = try? await AppStore.shared.placesForGlobe() }
        if let best = store.places?.places.max(by: { $0.samples < $1.samples }) {
            let name = best.label ?? best.suggestedLabel
            return (CLLocationCoordinate2D(latitude: best.latitude, longitude: best.longitude), name)
        }
        if let fix = await LocationSampler.shared.fixForLogging() {
            return (CLLocationCoordinate2D(latitude: fix.latitude, longitude: fix.longitude), nil)
        }
        return (Self.fallback, Self.fallbackName)
    }

    /// MKReverseGeocodingRequest rather than CLGeocoder, which is deprecated as of
    /// iOS 26 in favour of MapKit's own.
    private func reverseGeocode(_ coordinate: CLLocationCoordinate2D) async -> String? {
        let location = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        guard let request = MKReverseGeocodingRequest(location: location),
              let item = try? await request.mapItems.first else { return nil }
        return item.name ?? item.address?.shortAddress
    }
}
