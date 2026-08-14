import SwiftUI

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
    var source: String

    var id: String { name }
}

enum Journeys {
    /// Earth at the equator: 40,075 km. The one every distance is eventually measured
    /// against, and the reason the ring on this screen exists.
    static let earthCircumferenceMiles = 24_901.0

    static let all: [Journey] = [
        // ---- Swimming ---------------------------------------------------------------
        Journey(name: "Alcatraz to shore", detail: "The San Francisco crossing", miles: 1.25,
                modes: [.swimming], shape: .crossing, source: "≈2 km from Alcatraz to Aquatic Park, the standard Sharkfest route."),
        Journey(name: "Alcatraz and back", detail: "There and back again", miles: 2.5,
                modes: [.swimming], shape: .crossing, source: "Twice the ≈2 km crossing."),
        Journey(name: "The Strait of Gibraltar", detail: "Europe to Africa", miles: 9,
                modes: [.swimming], shape: .crossing, source: "≈14.4 km at the narrowest crossing."),
        Journey(name: "The English Channel", detail: "Dover to Calais", miles: 21,
                modes: [.swimming], shape: .crossing, source: "≈33.8 km, the shortest Channel swim route."),
        Journey(name: "The Catalina Channel", detail: "Catalina Island to California", miles: 21,
                modes: [.swimming], shape: .crossing, source: "≈32.3 km, Catalina Channel Swimming Federation."),
        Journey(name: "Loch Ness, end to end", detail: "The length of the loch", miles: 23,
                modes: [.swimming], shape: .river, source: "≈37 km along the loch's long axis."),
        Journey(name: "Around Manhattan", detail: "The 20 Bridges swim", miles: 28.5,
                modes: [.swimming, .walkRun], shape: .loop, source: "45.9 km circumnavigation of Manhattan Island."),

        // ---- Walking and running -------------------------------------------------------
        Journey(name: "A marathon", detail: "The classic distance", miles: 26.2,
                modes: [.walkRun], shape: .road, source: "42.195 km, fixed by the IAAF in 1921."),
        Journey(name: "The Grand Canyon, rim to rim", detail: "North Kaibab to Bright Angel", miles: 24,
                modes: [.walkRun], shape: .trail, source: "≈38 km, US National Park Service."),
        Journey(name: "The John Muir Trail", detail: "Yosemite to Mount Whitney", miles: 211,
                modes: [.walkRun], shape: .trail, source: "≈340 km, Pacific Crest Trail Association."),
        Journey(name: "The Camino Francés", detail: "The Pyrenees to Santiago", miles: 490,
                modes: [.walkRun, .cycling], shape: .trail, source: "≈789 km on the French Way."),
        Journey(name: "Land's End to John o' Groats", detail: "The length of Great Britain", miles: 874,
                modes: [.walkRun, .cycling], shape: .coast, source: "≈1,407 km by the walking route."),
        Journey(name: "The Appalachian Trail", detail: "Georgia to Maine", miles: 2_197,
                modes: [.walkRun], shape: .trail, source: "2,197 miles, Appalachian Trail Conservancy (length varies yearly)."),
        Journey(name: "The Pacific Crest Trail", detail: "Mexico to Canada", miles: 2_650,
                modes: [.walkRun], shape: .trail, source: "≈2,650 miles, Pacific Crest Trail Association."),
        Journey(name: "The Continental Divide Trail", detail: "The spine of the Rockies", miles: 3_100,
                modes: [.walkRun], shape: .trail, source: "≈3,100 miles, Continental Divide Trail Coalition."),

        // ---- Cycling ---------------------------------------------------------------------
        Journey(name: "The Tour de France", detail: "One edition, start to finish", miles: 2_170,
                modes: [.cycling], shape: .loop, source: "≈3,500 km; the route changes every year."),
        Journey(name: "The Pacific Coast Highway", detail: "Seattle to San Diego", miles: 1_800,
                modes: [.cycling], shape: .coast, source: "≈2,900 km down the US Pacific coast."),
        Journey(name: "Route 66", detail: "Chicago to Santa Monica", miles: 2_448,
                modes: [.cycling, .walkRun], shape: .road, source: "2,448 miles of the original US Highway 66."),
        Journey(name: "Race Across America", detail: "Oceanside to Annapolis", miles: 3_000,
                modes: [.cycling], shape: .road, source: "≈4,800 km, RAAM's transcontinental route."),

        // ---- Any distance is a distance ----------------------------------------------------
        Journey(name: "London to Paris", detail: "As the crow flies", miles: 214,
                modes: [.walkRun, .cycling, .swimming], shape: .crossing, source: "≈344 km great-circle distance."),
        Journey(name: "New York to Los Angeles", detail: "Coast to coast", miles: 2_451,
                modes: [.walkRun, .cycling, .swimming], shape: .road, source: "≈3,944 km great-circle distance."),
        Journey(name: "The Great Wall of China", detail: "The Ming-dynasty walls", miles: 5_500,
                modes: [.walkRun, .cycling, .swimming], shape: .wall, source: "≈8,850 km, Chinese State Administration of Cultural Heritage."),
        Journey(name: "The length of the Nile", detail: "Source to the Mediterranean", miles: 4_132,
                modes: [.walkRun, .cycling, .swimming], shape: .river, source: "≈6,650 km, the river's commonly cited length."),
        Journey(name: "Around the equator", detail: "All the way round", miles: earthCircumferenceMiles,
                modes: [.walkRun, .cycling, .swimming], shape: .equator, source: "40,075 km, Earth's equatorial circumference."),
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
