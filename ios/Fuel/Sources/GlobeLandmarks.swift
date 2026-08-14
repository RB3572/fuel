import Foundation
import CoreLocation

// The places a line around the world could plausibly be routed through, and something to
// say about each. Used twice: to choose which great circle to draw, and to tell you what
// you are near.

struct Landmark: Identifiable, Hashable {
    var name: String
    var lat: Double
    var lon: Double
    /// How well known it is, 1–3. The route search maximises this rather than a plain
    /// count, so a circle through the Pyramids and the Colosseum beats one that clips
    /// three places nobody has heard of.
    var fame: Int
    /// The aside, for when you turn out to be near it.
    var quip: String

    var id: String { name }
    var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: lat, longitude: lon) }
}

enum GlobeLandmarks {
    static let all: [Landmark] = [
        Landmark(name: "New York", lat: 40.6892, lon: -74.0445, fame: 3, quip: "grab a slice while you're at it"),
        Landmark(name: "the Eiffel Tower", lat: 48.8584, lon: 2.2945, fame: 3, quip: "the stairs are 674 steps, if you're still warmed up"),
        Landmark(name: "the Great Pyramid of Giza", lat: 29.9792, lon: 31.1342, fame: 3, quip: "older than mammoths were extinct"),
        Landmark(name: "the Colosseum", lat: 41.8902, lon: 12.4922, fame: 3, quip: "carbo-load first, obviously"),
        Landmark(name: "the Taj Mahal", lat: 27.1751, lon: 78.0421, fame: 3, quip: "twenty-two years to build, so no rush"),
        Landmark(name: "the Great Wall", lat: 40.4319, lon: 116.5704, fame: 3, quip: "you could keep going for another 5,500 miles"),
        Landmark(name: "Machu Picchu", lat: -13.1631, lon: -72.5450, fame: 3, quip: "7,970 feet up — bring lungs"),
        Landmark(name: "Christ the Redeemer", lat: -22.9519, lon: -43.2105, fame: 3, quip: "the stairs up are only 220"),
        Landmark(name: "the Sydney Opera House", lat: -33.8568, lon: 151.2153, fame: 3, quip: "a million tiles, all cleaned by hand"),
        Landmark(name: "Big Ben", lat: 51.5007, lon: -0.1246, fame: 3, quip: "the bell, not the tower — common mistake"),
        Landmark(name: "the Golden Gate Bridge", lat: 37.8199, lon: -122.4783, fame: 3, quip: "1.7 miles across, if you fancy one more"),
        Landmark(name: "Mount Everest", lat: 27.9881, lon: 86.9250, fame: 3, quip: "the last 3,000 feet are the awkward part"),
        Landmark(name: "the Grand Canyon", lat: 36.1069, lon: -112.1129, fame: 3, quip: "rim to rim is 24 miles and a lot of down"),
        Landmark(name: "the Pantheon", lat: 41.8986, lon: 12.4769, fame: 2, quip: "still the largest unreinforced concrete dome on Earth"),
        Landmark(name: "Santorini", lat: 36.3932, lon: 25.4615, fame: 2, quip: "the caldera is a drowned volcano — swim carefully"),
        Landmark(name: "Table Mountain", lat: -33.9628, lon: 18.4098, fame: 2, quip: "flat on top, which feels like cheating"),
        Landmark(name: "Petra", lat: 30.3285, lon: 35.4444, fame: 2, quip: "the walk in through the Siq is a mile of canyon"),
        Landmark(name: "Angkor Wat", lat: 13.4125, lon: 103.8670, fame: 2, quip: "the largest religious monument anywhere"),
        Landmark(name: "Niagara Falls", lat: 43.0962, lon: -79.0377, fame: 2, quip: "3,160 tons of water a second — don't swim this one"),
        Landmark(name: "Stonehenge", lat: 51.1789, lon: -1.8262, fame: 2, quip: "the stones walked 150 miles from Wales, more or less"),
        Landmark(name: "Mount Fuji", lat: 35.3606, lon: 138.7274, fame: 2, quip: "climbing season is July to September, and it's busy"),
        Landmark(name: "the Serengeti", lat: -2.3333, lon: 34.8333, fame: 2, quip: "the wildebeest do 500 miles a year, every year"),
        Landmark(name: "Iguazú Falls", lat: -25.6953, lon: -54.4367, fame: 2, quip: "275 separate waterfalls, and they're loud"),
        Landmark(name: "the Hagia Sophia", lat: 41.0086, lon: 28.9802, fame: 2, quip: "one foot in Europe, one in Asia"),
        Landmark(name: "Chichén Itzá", lat: 20.6843, lon: -88.5678, fame: 2, quip: "91 steps a side, 365 with the top"),
        Landmark(name: "Uluru", lat: -25.3444, lon: 131.0369, fame: 2, quip: "the walk around the base is 6.4 miles"),
        Landmark(name: "Neuschwanstein", lat: 47.5576, lon: 10.7498, fame: 2, quip: "the castle Disney copied"),
        Landmark(name: "the Burj Khalifa", lat: 25.1972, lon: 55.2744, fame: 2, quip: "2,909 steps to the top, and people race up them"),
        Landmark(name: "the Blue Lagoon", lat: 63.8804, lon: -22.4495, fame: 1, quip: "a good place to stop moving for a while"),
        Landmark(name: "the Panama Canal", lat: 9.0800, lon: -79.6800, fame: 2, quip: "51 miles that saved ships 8,000"),
        Landmark(name: "Victoria Falls", lat: -17.9243, lon: 25.8572, fame: 2, quip: "\"the smoke that thunders\", and it does"),
        Landmark(name: "the Bering Strait", lat: 65.7500, lon: -168.9500, fame: 1, quip: "55 miles between two continents"),
        Landmark(name: "Cape Horn", lat: -55.9833, lon: -67.2667, fame: 1, quip: "the sailors' Everest"),
        Landmark(name: "Honolulu", lat: 21.3069, lon: -157.8583, fame: 2, quip: "2,400 miles from anywhere else"),
        Landmark(name: "Reykjavík", lat: 64.1466, lon: -21.9426, fame: 1, quip: "the northernmost capital there is"),
        Landmark(name: "Cairo", lat: 30.0444, lon: 31.2357, fame: 2, quip: "the Nile has 4,132 miles on you"),
        Landmark(name: "Singapore", lat: 1.3521, lon: 103.8198, fame: 2, quip: "85 miles off the equator"),
        Landmark(name: "Cape Town", lat: -33.9249, lon: 18.4241, fame: 2, quip: "where two oceans argue"),
    ]
}

/// Great-circle arithmetic, in miles. Everything the globe needs to draw a loop and work
/// out what is near it.
enum Geo {
    static let earthRadiusMiles = 3958.8

    static func radians(_ degrees: Double) -> Double { degrees * .pi / 180 }
    static func degrees(_ radians: Double) -> Double { radians * 180 / .pi }

    /// Distance between two points along the surface.
    static func distance(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        let lat1 = radians(a.latitude), lat2 = radians(b.latitude)
        let dLat = lat2 - lat1
        let dLon = radians(b.longitude - a.longitude)
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * earthRadiusMiles * asin(min(1, sqrt(h)))
    }

    /// Initial bearing from one point to another, in degrees.
    static func bearing(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Double {
        let lat1 = radians(a.latitude), lat2 = radians(b.latitude)
        let dLon = radians(b.longitude - a.longitude)
        let y = sin(dLon) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
        return degrees(atan2(y, x))
    }

    /// The point reached by setting off from `from` on `bearing` and going `miles`.
    static func destination(_ from: CLLocationCoordinate2D, bearing: Double, miles: Double) -> CLLocationCoordinate2D {
        let angular = miles / earthRadiusMiles
        let lat1 = radians(from.latitude), lon1 = radians(from.longitude), theta = radians(bearing)
        let lat2 = asin(sin(lat1) * cos(angular) + cos(lat1) * sin(angular) * cos(theta))
        let lon2 = lon1 + atan2(sin(theta) * sin(angular) * cos(lat1), cos(angular) - sin(lat1) * sin(lat2))
        return CLLocationCoordinate2D(latitude: degrees(lat2),
                                      longitude: (degrees(lon2) + 540).truncatingRemainder(dividingBy: 360) - 180)
    }

    /// How far a point lies off a great circle — the perpendicular distance to it, which
    /// is what decides whether a route "passes through" somewhere.
    static func crossTrackDistance(point: CLLocationCoordinate2D,
                                   from start: CLLocationCoordinate2D, bearing courseBearing: Double) -> Double {
        let d13 = distance(start, point) / earthRadiusMiles
        let theta13 = radians(bearing(start, point))
        let theta12 = radians(courseBearing)
        return abs(asin(sin(d13) * sin(theta13 - theta12)) * earthRadiusMiles)
    }

    /// The full loop: one lap of the planet from `start` on the given bearing.
    static func greatCircle(from start: CLLocationCoordinate2D, bearing: Double, steps: Int = 180) -> [CLLocationCoordinate2D] {
        let lap = 2 * .pi * earthRadiusMiles
        return (0...steps).map { step in
            destination(start, bearing: bearing, miles: lap * Double(step) / Double(steps))
        }
    }

    /// The bearing whose loop passes closest to the most famous places. Swept rather than
    /// solved: a great circle through a fixed point has exactly one degree of freedom, so
    /// trying every one of them is both exact and cheap.
    static func mostScenicBearing(from start: CLLocationCoordinate2D,
                                  landmarks: [Landmark] = GlobeLandmarks.all,
                                  corridorMiles: Double = 600) -> (bearing: Double, passes: [Landmark]) {
        var best = (bearing: 0.0, score: -1.0, passes: [Landmark]())
        for degree in stride(from: 0.0, to: 180.0, by: 1.0) {
            var score = 0.0
            var passes: [Landmark] = []
            for landmark in landmarks {
                let off = crossTrackDistance(point: landmark.coordinate, from: start, bearing: degree)
                guard off < corridorMiles else { continue }
                // Nearer counts for more, so a circle that runs right over a place beats
                // one that merely comes within the corridor.
                score += Double(landmark.fame) * (1 - off / corridorMiles)
                passes.append(landmark)
            }
            if score > best.score { best = (degree, score, passes) }
        }
        let ordered = best.passes.sorted {
            distance(start, $0.coordinate) < distance(start, $1.coordinate)
        }
        return (best.bearing, ordered)
    }
}
