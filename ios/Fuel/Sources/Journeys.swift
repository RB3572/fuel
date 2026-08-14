import SwiftUI
import CoreLocation

// Distance you have actually covered, put next to distances that mean something.
//
// "7,700 miles" is a number. "Two and a half times the Appalachian Trail" is a picture,
// and the picture is the whole point of this screen. Every route below is a real one at
// its published length, so the comparison holds up if you go and check it.
//
// Each journey is tagged with the modes it suits, because the interesting comparison
// depends on how the distance was covered: a swimmer wants channel crossings, a walker
// wants long trails. A handful are marked for every mode — the equator, the Nile — since
// scale is scale however you covered it.

enum JourneyMode: String, CaseIterable, Identifiable, Hashable {
    case walkRun = "Walking & running"
    case cycling = "Cycling"
    case swimming = "Swimming"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .walkRun: return "figure.walk"
        case .cycling: return "figure.outdoor.cycle"
        case .swimming: return "figure.pool.swim"
        }
    }

    var shortName: String {
        switch self {
        case .walkRun: return "Walk & run"
        case .cycling: return "Cycle"
        case .swimming: return "Swim"
        }
    }
}

/// The shape drawn behind a journey. Not cartography — a stylised gesture that says
/// which *kind* of place this is, so a channel crossing and a mountain trail do not get
/// the same picture. Each one is a path the completed-laps line is then traced along.
enum JourneyShape: String, Hashable {
    case crossing      // open water between two shores
    case trail         // a ridge line through mountains
    case wall          // crenellated, for the Great Wall
    case river         // a meander
    case loop          // a circuit that returns to itself
    case coast         // a long shoreline curve
    case road          // a highway with a dashed centre line
    case equator       // the circle itself
}

struct Journey: Identifiable, Hashable {
    var name: String
    /// Where it is, or what it is — the half-line under the name.
    var detail: String
    var miles: Double
    var modes: Set<JourneyMode>
    var shape: JourneyShape
    /// The route on the ground, as waypoints. Coarse on purpose — a dozen points is
    /// enough to put a line through the right mountains and rivers at the size this is
    /// drawn, and a full trail trace would be tens of thousands of coordinates for a
    /// picture two inches across.
    var waypoints: [Waypoint]
    var source: String

    /// A plain pair, so the catalogue reads as data rather than as constructor calls.
    struct Waypoint: Hashable {
        var lat: Double
        var lon: Double
        var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
    }

    var coordinates: [CLLocationCoordinate2D] { waypoints.map(\.coordinate) }

    var id: String { name }
}

enum Journeys {
    /// Earth at the equator: 40,075 km. The one every distance is eventually measured
    /// against, and the reason the ring on this screen exists.
    static let earthCircumferenceMiles = 24_901.0

    static let all: [Journey] = [
        // ---- Swimming ---------------------------------------------------------------
        Journey(name: "Alcatraz to shore", detail: "The San Francisco crossing", miles: 1.25,
                modes: [.swimming], shape: .crossing, waypoints: [.init(lat: 37.8267, lon: -122.423), .init(lat: 37.818, lon: -122.4245), .init(lat: 37.808, lon: -122.423)],
                source: "≈2 km from Alcatraz to Aquatic Park, the standard Sharkfest route."),
        Journey(name: "Alcatraz and back", detail: "There and back again", miles: 2.5,
                modes: [.swimming], shape: .crossing, waypoints: [.init(lat: 37.808, lon: -122.423), .init(lat: 37.818, lon: -122.4245), .init(lat: 37.8267, lon: -122.423), .init(lat: 37.818, lon: -122.421), .init(lat: 37.808, lon: -122.423)],
                source: "Twice the ≈2 km crossing."),
        Journey(name: "The Strait of Gibraltar", detail: "Europe to Africa", miles: 9,
                modes: [.swimming], shape: .crossing, waypoints: [.init(lat: 36.0128, lon: -5.6096), .init(lat: 35.96, lon: -5.53), .init(lat: 35.9167, lon: -5.4667)],
                source: "≈14.4 km at the narrowest crossing."),
        Journey(name: "The English Channel", detail: "Dover to Calais", miles: 21,
                modes: [.swimming], shape: .crossing, waypoints: [.init(lat: 51.1279, lon: 1.3134), .init(lat: 51.03, lon: 1.42), .init(lat: 50.92, lon: 1.52), .init(lat: 50.8703, lon: 1.5856)],
                source: "≈33.8 km, the shortest Channel swim route."),
        Journey(name: "The Catalina Channel", detail: "Catalina Island to California", miles: 21,
                modes: [.swimming], shape: .crossing, waypoints: [.init(lat: 33.4453, lon: -118.4854), .init(lat: 33.56, lon: -118.46), .init(lat: 33.65, lon: -118.43), .init(lat: 33.742, lon: -118.4106)],
                source: "≈32.3 km, Catalina Channel Swimming Federation."),
        Journey(name: "Loch Ness, end to end", detail: "The length of the loch", miles: 23,
                modes: [.swimming], shape: .river, waypoints: [.init(lat: 57.4, lon: -4.4), .init(lat: 57.25, lon: -4.48), .init(lat: 57.1, lon: -4.58), .init(lat: 56.95, lon: -4.65)],
                source: "≈37 km along the loch's long axis."),
        Journey(name: "Around Manhattan", detail: "The 20 Bridges swim", miles: 28.5,
                modes: [.swimming, .walkRun], shape: .loop, waypoints: [.init(lat: 40.7061, lon: -74.0169), .init(lat: 40.75, lon: -74.01), .init(lat: 40.8, lon: -73.97), .init(lat: 40.87, lon: -73.92), .init(lat: 40.8, lon: -73.93), .init(lat: 40.74, lon: -73.97), .init(lat: 40.7061, lon: -74.0169)],
                source: "45.9 km circumnavigation of Manhattan Island."),

        // ---- Walking and running -------------------------------------------------------
        Journey(name: "A marathon", detail: "The classic distance", miles: 26.2,
                modes: [.walkRun], shape: .road, waypoints: [.init(lat: 42.2287, lon: -71.5226), .init(lat: 42.28, lon: -71.42), .init(lat: 42.31, lon: -71.26), .init(lat: 42.33, lon: -71.15), .init(lat: 42.3496, lon: -71.0785)],
                source: "42.195 km, fixed by the IAAF in 1921."),
        Journey(name: "The Grand Canyon, rim to rim", detail: "North Kaibab to Bright Angel", miles: 24,
                modes: [.walkRun], shape: .trail, waypoints: [.init(lat: 36.217, lon: -112.057), .init(lat: 36.16, lon: -112.08), .init(lat: 36.1, lon: -112.09), .init(lat: 36.0574, lon: -112.1435)],
                source: "≈38 km, US National Park Service."),
        Journey(name: "The John Muir Trail", detail: "Yosemite to Mount Whitney", miles: 211,
                modes: [.walkRun], shape: .trail, waypoints: [.init(lat: 37.732, lon: -119.5583), .init(lat: 37.5, lon: -119.0), .init(lat: 37.2, lon: -118.8), .init(lat: 36.9, lon: -118.5), .init(lat: 36.5785, lon: -118.2923)],
                source: "≈340 km, Pacific Crest Trail Association."),
        Journey(name: "The Camino Francés", detail: "The Pyrenees to Santiago", miles: 490,
                modes: [.walkRun, .cycling], shape: .trail, waypoints: [.init(lat: 43.163, lon: -1.238), .init(lat: 42.81, lon: -1.65), .init(lat: 42.46, lon: -2.45), .init(lat: 42.34, lon: -3.7), .init(lat: 42.6, lon: -5.57), .init(lat: 42.8805, lon: -8.5457)],
                source: "≈789 km on the French Way."),
        Journey(name: "Land's End to John o' Groats", detail: "The length of Great Britain", miles: 874,
                modes: [.walkRun, .cycling], shape: .coast, waypoints: [.init(lat: 50.0657, lon: -5.7132), .init(lat: 51.45, lon: -2.59), .init(lat: 52.48, lon: -1.9), .init(lat: 53.8, lon: -1.55), .init(lat: 55.95, lon: -3.19), .init(lat: 57.48, lon: -4.22), .init(lat: 58.6373, lon: -3.0689)],
                source: "≈1,407 km by the walking route."),
        Journey(name: "The Appalachian Trail", detail: "Georgia to Maine", miles: 2_197,
                modes: [.walkRun], shape: .trail, waypoints: [.init(lat: 34.6266, lon: -84.1938), .init(lat: 36.0, lon: -81.8), .init(lat: 37.5, lon: -79.5), .init(lat: 39.3, lon: -77.7), .init(lat: 41.3, lon: -74.5), .init(lat: 43.5, lon: -71.5), .init(lat: 45.9044, lon: -68.9216)],
                source: "2,197 miles, Appalachian Trail Conservancy (length varies yearly)."),
        Journey(name: "The Pacific Crest Trail", detail: "Mexico to Canada", miles: 2_650,
                modes: [.walkRun], shape: .trail, waypoints: [.init(lat: 32.6, lon: -116.4667), .init(lat: 34.3, lon: -117.5), .init(lat: 36.5, lon: -118.3), .init(lat: 39.3, lon: -120.3), .init(lat: 42.0, lon: -122.0), .init(lat: 45.5, lon: -121.8), .init(lat: 49.0645, lon: -120.7815)],
                source: "≈2,650 miles, Pacific Crest Trail Association."),
        Journey(name: "The Continental Divide Trail", detail: "The spine of the Rockies", miles: 3_100,
                modes: [.walkRun], shape: .trail, waypoints: [.init(lat: 31.75, lon: -108.5), .init(lat: 34.5, lon: -108.0), .init(lat: 37.5, lon: -106.5), .init(lat: 41.0, lon: -106.5), .init(lat: 44.5, lon: -110.5), .init(lat: 48.997, lon: -113.69)],
                source: "≈3,100 miles, Continental Divide Trail Coalition."),

        // ---- Cycling ---------------------------------------------------------------------
        Journey(name: "The Tour de France", detail: "One edition, start to finish", miles: 2_170,
                modes: [.cycling], shape: .loop, waypoints: [.init(lat: 48.8566, lon: 2.3522), .init(lat: 47.322, lon: 5.0415), .init(lat: 45.764, lon: 4.8357), .init(lat: 43.6047, lon: 1.4442), .init(lat: 43.2965, lon: 5.3698), .init(lat: 44.8378, lon: -0.5792), .init(lat: 47.2184, lon: -1.5536), .init(lat: 48.8566, lon: 2.3522)],
                source: "≈3,500 km; the route changes every year."),
        Journey(name: "The Pacific Coast Highway", detail: "Seattle to San Diego", miles: 1_800,
                modes: [.cycling], shape: .coast, waypoints: [.init(lat: 47.6062, lon: -122.3321), .init(lat: 45.5152, lon: -122.6784), .init(lat: 43.3665, lon: -124.2179), .init(lat: 40.8021, lon: -124.1637), .init(lat: 37.7749, lon: -122.4194), .init(lat: 35.3659, lon: -120.8499), .init(lat: 34.0195, lon: -118.4912), .init(lat: 32.7157, lon: -117.1611)],
                source: "≈2,900 km down the US Pacific coast."),
        Journey(name: "Route 66", detail: "Chicago to Santa Monica", miles: 2_448,
                modes: [.cycling, .walkRun], shape: .road, waypoints: [.init(lat: 41.8781, lon: -87.6298), .init(lat: 38.627, lon: -90.1994), .init(lat: 37.0842, lon: -94.5133), .init(lat: 35.4676, lon: -97.5164), .init(lat: 35.222, lon: -101.8313), .init(lat: 35.0844, lon: -106.6504), .init(lat: 35.1983, lon: -111.6513), .init(lat: 34.0195, lon: -118.4912)],
                source: "2,448 miles of the original US Highway 66."),
        Journey(name: "Race Across America", detail: "Oceanside to Annapolis", miles: 3_000,
                modes: [.cycling], shape: .road, waypoints: [.init(lat: 33.1959, lon: -117.3795), .init(lat: 34.5, lon: -112.47), .init(lat: 37.0, lon: -105.5), .init(lat: 38.8, lon: -97.61), .init(lat: 39.1, lon: -90.2), .init(lat: 39.6, lon: -84.2), .init(lat: 39.9, lon: -79.0), .init(lat: 38.9784, lon: -76.4922)],
                source: "≈4,800 km, RAAM's transcontinental route."),

        // ---- Any distance is a distance ----------------------------------------------------
        Journey(name: "London to Paris", detail: "As the crow flies", miles: 214,
                modes: [.walkRun, .cycling, .swimming], shape: .crossing, waypoints: [.init(lat: 51.5074, lon: -0.1278), .init(lat: 50.9, lon: 1.0), .init(lat: 49.8, lon: 2.0), .init(lat: 48.8566, lon: 2.3522)],
                source: "≈344 km great-circle distance."),
        Journey(name: "New York to Los Angeles", detail: "Coast to coast", miles: 2_451,
                modes: [.walkRun, .cycling, .swimming], shape: .road, waypoints: [.init(lat: 40.7128, lon: -74.006), .init(lat: 41.4993, lon: -81.6944), .init(lat: 41.8781, lon: -87.6298), .init(lat: 39.0997, lon: -94.5786), .init(lat: 39.7392, lon: -104.9903), .init(lat: 40.7608, lon: -111.891), .init(lat: 36.1699, lon: -115.1398), .init(lat: 34.0522, lon: -118.2437)],
                source: "≈3,944 km great-circle distance."),
        Journey(name: "The Great Wall of China", detail: "The Ming-dynasty walls", miles: 5_500,
                modes: [.walkRun, .cycling, .swimming], shape: .wall, waypoints: [.init(lat: 39.8, lon: 98.29), .init(lat: 38.93, lon: 100.45), .init(lat: 38.5, lon: 105.2), .init(lat: 39.8, lon: 110.0), .init(lat: 40.4, lon: 113.3), .init(lat: 40.4319, lon: 116.5704), .init(lat: 40.0, lon: 119.75)],
                source: "≈8,850 km, Chinese State Administration of Cultural Heritage."),
        Journey(name: "The length of the Nile", detail: "Source to the Mediterranean", miles: 4_132,
                modes: [.walkRun, .cycling, .swimming], shape: .river, waypoints: [.init(lat: -0.5, lon: 33.0), .init(lat: 2.0, lon: 31.5), .init(lat: 9.5, lon: 31.6), .init(lat: 15.5, lon: 32.5), .init(lat: 18.5, lon: 31.8), .init(lat: 24.09, lon: 32.9), .init(lat: 27.18, lon: 31.2), .init(lat: 30.0444, lon: 31.2357), .init(lat: 31.5, lon: 30.0)],
                source: "≈6,650 km, the river's commonly cited length."),
        Journey(name: "Around the equator", detail: "All the way round", miles: earthCircumferenceMiles,
                modes: [.walkRun, .cycling, .swimming], shape: .equator, waypoints: [.init(lat: 0, lon: -180), .init(lat: 0, lon: -135), .init(lat: 0, lon: -90), .init(lat: 0, lon: -45), .init(lat: 0, lon: 0), .init(lat: 0, lon: 45), .init(lat: 0, lon: 90), .init(lat: 0, lon: 135), .init(lat: 0, lon: 180)],
                source: "40,075 km, Earth's equatorial circumference."),
    ]

    /// The journeys worth showing for a given distance and set of modes: everything the
    /// person has already covered at least once, plus the next one still ahead of them,
    /// so the list always ends on something to aim at rather than trailing off.
    static func relevant(miles: Double, modes: Set<JourneyMode>) -> (completed: [Journey], next: Journey?) {
        let pool = all
            .filter { journey in modes.isEmpty || !journey.modes.isDisjoint(with: modes) }
            .sorted { $0.miles < $1.miles }
        let completed = pool.filter { $0.miles <= miles }
        let next = pool.first { $0.miles > miles }
        // Longest first: "you have done this twice over" is more interesting than the
        // shortest thing you passed years ago.
        return (completed.reversed(), next)
    }
}
