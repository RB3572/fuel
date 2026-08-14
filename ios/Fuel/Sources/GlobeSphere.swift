import SwiftUI
import CoreLocation

// A globe drawn from scratch, because the map framework was the wrong tool for it.
//
// MapKit at 22,000 km is rendering the entire planet, and driving its camera from a drag
// meant re-rendering all of it on every frame — roughly two of them a second. Nothing
// about that is fixable from the outside: the cost is the tile pipeline, not the way it
// was being asked.
//
// This draws the sphere directly instead. Rotation is two numbers, projection is a few
// lines of trigonometry per point, and a frame is one Canvas pass over about eight
// hundred points — microseconds of work rather than a re-render of the world. It also
// gives back what the map could not: proper back-face hiding, so the far side of the
// route disappears behind the sphere the way it should.

/// Orthographic projection — the view of a sphere from infinitely far away, which is
/// what a globe looks like. Points on the far hemisphere report themselves invisible.
struct Orthographic {
    /// Where the viewer is over, in degrees.
    var centreLat: Double
    var centreLon: Double
    var radius: Double
    var centre: CGPoint

    func project(_ lat: Double, _ lon: Double) -> (point: CGPoint, visible: Bool) {
        let φ = lat * .pi / 180, λ = lon * .pi / 180
        let φ0 = centreLat * .pi / 180, λ0 = centreLon * .pi / 180
        let cosC = sin(φ0) * sin(φ) + cos(φ0) * cos(φ) * cos(λ - λ0)
        let x = cos(φ) * sin(λ - λ0)
        let y = cos(φ0) * sin(φ) - sin(φ0) * cos(φ) * cos(λ - λ0)
        return (CGPoint(x: centre.x + radius * x, y: centre.y - radius * y), cosC >= 0)
    }
}

/// The world, coarsely. Enough to recognise a continent at three inches across, and
/// small enough that redrawing every outline is free. Each entry is a closed outline in
/// (latitude, longitude) pairs.
enum GlobeAtlas {
    typealias Outline = [(Double, Double)]

    static let northAmerica: Outline = [
        (71,-156),(70,-143),(69,-135),(60,-140),(59,-136),(55,-130),(49,-125),(40,-124),
        (34,-120),(32,-117),(28,-114),(23,-110),(23,-106),(19,-105),(16,-95),(15,-92),
        (13,-88),(16,-88),(21,-87),(21,-90),(19,-96),(26,-97),(29,-94),(29,-89),(30,-84),
        (25,-81),(31,-81),(35,-76),(40,-74),(42,-70),(45,-67),(48,-59),(52,-56),(55,-60),
        (60,-65),(63,-78),(56,-79),(55,-83),(57,-92),(60,-95),(64,-88),(68,-85),(70,-95),
        (69,-105),(70,-115),(70,-130),
    ]

    static let southAmerica: Outline = [
        (12,-72),(11,-64),(10,-61),(5,-52),(0,-50),(-5,-36),(-8,-35),(-13,-38),(-23,-43),
        (-33,-53),(-38,-57),(-41,-63),(-47,-66),(-53,-68),(-55,-67),(-53,-72),(-46,-75),
        (-41,-74),(-33,-72),(-23,-70),(-18,-71),(-14,-76),(-6,-81),(-2,-81),(1,-79),
        (7,-78),(9,-76),
    ]

    static let africa: Outline = [
        (37,10),(33,11),(32,15),(31,20),(31,25),(31,32),(22,37),(15,40),(12,43),(11,51),
        (2,46),(-4,40),(-11,40),(-18,36),(-26,33),(-34,26),(-34,19),(-29,17),(-23,14),
        (-17,12),(-9,13),(-1,9),(4,9),(6,3),(5,-4),(10,-13),(15,-17),(20,-17),(24,-15),
        (28,-11),(31,-9),(35,-6),(37,-2),
    ]

    static let eurasia: Outline = [
        (36,-6),(43,-9),(48,-5),(50,0),(53,5),(58,10),(63,5),(70,20),(70,30),(69,40),
        (73,55),(76,70),(73,80),(76,100),(72,110),(70,130),(66,170),(62,179),(60,163),
        (54,160),(50,155),(45,140),(40,130),(35,126),(30,122),(22,110),(10,105),(8,100),
        (15,95),(20,92),(22,88),(16,80),(8,77),(15,72),(20,70),(25,66),(25,57),(20,58),
        (15,52),(13,45),(28,35),(31,32),(36,36),(41,29),(40,26),(38,23),(37,15),(41,17),
        (45,13),(44,9),(41,3),(38,0),
    ]

    static let australia: Outline = [
        (-11,131),(-12,137),(-16,140),(-11,143),(-16,146),(-21,149),(-28,153),(-34,151),
        (-38,146),(-38,141),(-35,137),(-32,134),(-34,124),(-34,116),(-31,115),(-26,113),
        (-22,114),(-18,122),(-14,126),
    ]

    static let greenland: Outline = [
        (83,-32),(81,-20),(76,-20),(70,-22),(66,-34),(60,-43),(66,-53),(72,-56),(78,-70),(82,-60),
    ]

    static let madagascar: Outline = [(-12,49),(-15,50),(-20,49),(-25,47),(-25,44),(-20,44),(-16,46)]

    static let japan: Outline = [
        (45,142),(43,145),(39,142),(35,141),(34,136),(35,133),(33,130),(31,130),(34,132),
        (36,136),(38,139),(41,140),
    ]

    static let britishIsles: Outline = [(58,-5),(57,-2),(54,0),(51,1),(50,-4),(53,-5),(55,-6)]

    static let newZealand: Outline = [
        (-34,173),(-37,176),(-39,177),(-41,175),(-41,172),(-45,167),(-47,168),(-44,171),(-41,174),(-37,174),
    ]

    /// Antarctica as a cap: a ring at 70° south, which is what it looks like from
    /// anywhere that is not directly above it.
    static let antarctica: Outline = stride(from: -180.0, through: 180.0, by: 15.0).map { (-70.0, $0) }

    static let all: [Outline] = [
        northAmerica, southAmerica, africa, eurasia, australia,
        greenland, madagascar, japan, britishIsles, newZealand, antarctica,
    ]
}

/// The sphere itself: land, grid, your lap around it, and the places it passes.
struct GlobeSphere: View {
    @Environment(\.colorScheme) private var scheme

    var route: [CLLocationCoordinate2D]
    var origin: CLLocationCoordinate2D?
    var landmarks: [Landmark]
    /// Where the viewer is over. Owned by the parent so the drag can move it.
    var centreLat: Double
    var centreLon: Double

    var body: some View {
        Canvas(rendersAsynchronously: false) { context, size in
            let radius = min(size.width, size.height) / 2 - 2
            let projection = Orthographic(centreLat: centreLat, centreLon: centreLon,
                                          radius: radius,
                                          centre: CGPoint(x: size.width / 2, y: size.height / 2))
            let globe = Path(ellipseIn: CGRect(x: size.width / 2 - radius, y: size.height / 2 - radius,
                                               width: radius * 2, height: radius * 2))

            context.fill(globe, with: .color(ocean))
            // Everything else is clipped to the disc, so a polygon that straddles the
            // horizon cannot spill into the space around the planet.
            context.clip(to: globe)

            for outline in GlobeAtlas.all {
                for run in visibleRuns(outline, projection, closed: true) where run.count > 2 {
                    var path = Path()
                    path.move(to: run[0])
                    for point in run.dropFirst() { path.addLine(to: point) }
                    path.closeSubpath()
                    context.fill(path, with: .color(land))
                }
            }

            context.stroke(graticule(projection), with: .color(grid), lineWidth: 0.5)

            if route.count > 1 {
                let coordinates = route.map { ($0.latitude, $0.longitude) }
                for run in visibleRuns(coordinates, projection, closed: false) where run.count > 1 {
                    var path = Path()
                    path.move(to: run[0])
                    for point in run.dropFirst() { path.addLine(to: point) }
                    context.stroke(path, with: .color(DashboardTheme.shared.accent),
                                   style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                }
            }

            for landmark in landmarks {
                let projected = projection.project(landmark.lat, landmark.lon)
                guard projected.visible else { continue }
                context.fill(dot(at: projected.point, radius: 3), with: .color(.white))
                context.stroke(dot(at: projected.point, radius: 3), with: .color(DashboardTheme.shared.accent), lineWidth: 1.5)
            }

            if let origin {
                let projected = projection.project(origin.latitude, origin.longitude)
                if projected.visible {
                    context.fill(dot(at: projected.point, radius: 5.5), with: .color(DashboardTheme.shared.accent))
                    context.stroke(dot(at: projected.point, radius: 5.5), with: .color(.white), lineWidth: 2)
                }
            }
        }
        .background(Circle().fill(ocean))
        .clipShape(Circle())
        .overlay(Circle().stroke(Palette.border(scheme), lineWidth: 1))
    }

    private var ocean: Color { scheme == .dark ? Color(hex: 0x14202E) : Color(hex: 0xCFE3F2) }
    private var land: Color { scheme == .dark ? Color(hex: 0x2C3A2E) : Color(hex: 0xDCE8D5) }
    private var grid: Color { (scheme == .dark ? Color.white : Color.black).opacity(0.12) }

    private func dot(at point: CGPoint, radius: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2))
    }

    /// Splits a line of coordinates into the stretches that are on the near side. A run
    /// ends the moment a point goes round the back, which is what stops a route from
    /// drawing a chord straight across the face of the globe.
    private func visibleRuns(_ coordinates: [(Double, Double)], _ projection: Orthographic,
                             closed: Bool) -> [[CGPoint]] {
        var runs: [[CGPoint]] = []
        var current: [CGPoint] = []
        let sequence = closed ? coordinates + [coordinates[0]] : coordinates
        for (lat, lon) in sequence {
            let projected = projection.project(lat, lon)
            if projected.visible {
                current.append(projected.point)
            } else if !current.isEmpty {
                runs.append(current)
                current = []
            }
        }
        if !current.isEmpty { runs.append(current) }
        return runs
    }

    /// Meridians and parallels every thirty degrees, so the sphere reads as turning
    /// rather than as a shape changing size.
    private func graticule(_ projection: Orthographic) -> Path {
        var path = Path()
        for lon in stride(from: -180.0, to: 180.0, by: 30.0) {
            let line = stride(from: -90.0, through: 90.0, by: 5.0).map { ($0, lon) }
            for run in visibleRuns(line, projection, closed: false) where run.count > 1 {
                path.move(to: run[0])
                for point in run.dropFirst() { path.addLine(to: point) }
            }
        }
        for lat in stride(from: -60.0, through: 60.0, by: 30.0) {
            let line = stride(from: -180.0, through: 180.0, by: 5.0).map { (lat, $0) }
            for run in visibleRuns(line, projection, closed: false) where run.count > 1 {
                path.move(to: run[0])
                for point in run.dropFirst() { path.addLine(to: point) }
            }
        }
        return path
    }
}
