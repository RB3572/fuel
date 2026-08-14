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
// lines of trigonometry per point, and a frame is one Canvas pass over a couple of
// thousand points — microseconds of work rather than a re-render of the world. It also
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

    /// Where a point round the back sits on the rim: the same compass direction out of
    /// the centre, pushed to the edge of the disc.
    ///
    /// A hidden point has no honest place on the face, but dropping it and closing the
    /// gap draws a chord straight across the planet. Pinning it to the rim is the
    /// truthful alternative — a coastline turning away from you foreshortens to nothing
    /// exactly at the horizon, so its hidden stretch collapses onto the rim and adds no
    /// area of its own.
    func onLimb(_ lat: Double, _ lon: Double) -> CGPoint {
        let raw = project(lat, lon).point
        let dx = raw.x - centre.x, dy = raw.y - centre.y
        let length = max(1e-9, (dx * dx + dy * dy).squareRoot())
        return CGPoint(x: centre.x + dx / length * radius, y: centre.y + dy / length * radius)
    }
}

/// The world, in outline. Coarse enough that redrawing every coast is free, detailed
/// enough that you can pick out Baja, the Bothnian gulf and the Kamchatka peninsula at
/// three inches across. Each entry is a closed outline in (latitude, longitude) pairs,
/// traced so that inland seas — the Gulf of California, the Baltic, the Red Sea — are
/// intrusions in the polygon rather than holes, which keeps every shape simple.
enum GlobeAtlas {
    typealias Outline = [(Double, Double)]

    // MARK: - Continents

    /// From Point Barrow east along the Arctic coast, down the Atlantic, round the Gulf,
    /// through Central America, up the Pacific by way of the Gulf of California, and home
    /// across the Bering coast of Alaska.
    static let northAmerica: Outline = [
        (71,-157),(70,-146),(69,-137),(69,-133),(70,-128),(69,-120),(68,-112),(68,-105),
        (68,-98),(70,-92),(68,-86),(66,-86),(64,-88),(62,-92),(59,-94),(57,-92),(56,-88),
        (55,-85),(53,-82),(52,-79),(55,-77),(58,-77),(60,-78),(62,-73),(60,-70),(58,-66),
        (56,-62),(54,-58),(52,-56),(50,-58),(48,-62),(47,-65),(45,-66),(45,-67),(43,-70),
        (42,-70),(41,-72),(40,-74),(38,-75),(36,-76),(35,-76),(33,-79),(31,-81),(29,-81),
        (26,-80),(25,-81),(26,-82),(28,-83),(30,-84),(30,-87),(29,-89),(29,-94),(27,-97),
        (24,-98),(21,-97),(19,-96),(18,-94),(19,-91),(21,-90),(21,-87),(18,-88),(16,-88),
        (15,-83),(12,-83),(9,-82),(8,-77),(8,-79),(10,-85),(13,-88),(15,-93),(16,-98),
        (18,-103),(20,-105),(23,-106),(26,-109),(28,-111),(31,-114),(29,-113),(27,-112),
        (24,-110),(23,-110),(25,-112),(28,-115),(30,-116),(32,-117),(34,-120),(36,-122),
        (38,-123),(41,-124),(44,-124),(47,-124),(48,-125),(50,-128),(53,-132),(56,-134),
        (58,-137),(60,-140),(60,-145),(60,-148),(59,-152),(57,-155),(56,-159),(55,-163),
        (58,-158),(59,-162),(61,-166),(63,-165),(64,-161),(65,-167),(66,-164),(68,-166),
        (69,-163),(70,-160),
    ]

    static let southAmerica: Outline = [
        (12,-72),(11,-64),(10,-61),(8,-59),(5,-52),(2,-50),(-1,-47),(-3,-40),(-5,-36),
        (-8,-35),(-13,-39),(-18,-39),(-23,-43),(-25,-48),(-30,-50),(-34,-54),(-36,-57),
        (-39,-62),(-43,-65),(-48,-66),(-52,-68),(-55,-67),(-53,-71),(-50,-75),(-46,-75),
        (-41,-74),(-37,-73),(-33,-72),(-27,-71),(-23,-70),(-18,-71),(-14,-76),(-9,-79),
        (-5,-81),(-2,-81),(1,-79),(4,-77),(7,-78),(9,-76),(11,-74),
    ]

    static let africa: Outline = [
        (37,10),(33,11),(31,15),(32,20),(31,25),(31,32),(28,34),(24,35),(18,38),(15,40),
        (12,43),(11,44),(12,51),(8,49),(4,48),(2,46),(-2,41),(-7,39),(-11,40),(-16,40),
        (-21,35),(-26,33),(-29,32),(-34,26),(-34,19),(-31,18),(-26,15),(-22,14),(-17,12),
        (-12,13),(-8,13),(-6,12),(-3,9),(0,9),(4,9),(6,3),(5,-2),(5,-8),(7,-13),(10,-15),
        (13,-17),(16,-17),(20,-17),(24,-15),(28,-11),(31,-9),(34,-6),(36,-1),(37,3),
    ]

    /// The long one. Iberia, the Channel, the Baltic, Fennoscandia, the Siberian Arctic,
    /// Chukotka, Kamchatka, the Sea of Okhotsk, Korea, China, south-east Asia, India,
    /// Arabia, the Levant, Anatolia, the Aegean, the Adriatic and back along the
    /// Mediterranean.
    static let eurasia: Outline = [
        (36,-6),(38,-9),(41,-9),(43,-9),(44,-2),(46,-1),(47,-4),(48,-5),(49,-2),(50,1),
        (51,2),(53,5),(54,9),(55,8),(57,9),(56,11),(54,11),(54,14),(54,19),(56,21),
        (57,22),(59,24),(60,28),(61,25),(62,21),(64,22),(65,25),(64,21),(63,18),(61,17),
        (59,18),(57,17),(56,16),(55,14),(56,12),(58,11),(59,11),(58,7),(59,5),(61,5),
        (63,8),(65,12),(67,14),(68,16),(70,20),(71,24),(71,28),(70,31),(69,33),(68,38),
        (66,34),(64,36),(65,40),(66,45),(68,44),(68,50),(69,55),(71,58),(71,66),(73,70),
        (71,72),(69,73),(70,78),(73,80),(76,90),(77,100),(78,105),(76,112),(74,113),
        (73,120),(73,127),(71,132),(72,140),(70,146),(69,155),(69,161),(68,170),(66,175),
        (66,179),(64,177),(62,179),(62,174),(60,166),(58,163),(56,162),(54,161),(52,158),
        (51,157),(53,156),(55,156),(57,157),(59,160),(61,161),(62,160),(61,157),(59,154),
        (59,150),(58,141),(56,138),(54,140),(53,141),(51,141),(49,140),(47,139),(45,137),
        (43,135),(42,131),(39,128),(37,129),(35,129),(34,127),(35,126),(37,126),(38,125),
        (40,124),(40,122),(38,121),(37,122),(35,120),(32,121),(30,122),(28,121),(25,119),
        (22,114),(21,110),(21,108),(19,106),(17,107),(13,109),(11,109),(9,105),(10,104),
        (13,101),(11,100),(8,99),(6,100),(2,103),(1,104),(5,100),(8,98),(12,98),(16,97),
        (16,94),(20,93),(22,90),(21,88),(19,85),(16,81),(13,80),(10,80),(8,77),(11,75),
        (15,74),(19,73),(21,72),(23,68),(25,67),(25,62),(25,57),(23,58),(20,58),(17,55),
        (13,48),(13,45),(15,42),(18,41),(21,39),(25,37),(28,35),(29,35),(31,34),(34,36),
        (36,36),(36,34),(37,31),(37,28),(38,26),(40,26),(40,23),(38,24),(37,23),(37,21),
        (39,20),(40,19),(42,19),(44,15),(45,13),(44,12),(42,15),(40,18),(38,16),(40,15),
        (41,13),(43,10),(44,8),(43,7),(43,3),(42,3),(41,1),(39,0),(38,-1),(37,-2),(36,-5),
    ]

    static let australia: Outline = [
        (-11,131),(-12,137),(-16,140),(-11,143),(-16,146),(-21,149),(-25,153),(-28,153),
        (-34,151),(-38,148),(-38,146),(-38,141),(-35,139),(-33,137),(-32,134),(-32,128),
        (-34,124),(-34,119),(-34,116),(-31,115),(-26,113),(-22,114),(-20,119),(-18,122),
        (-16,124),(-14,126),(-12,130),
    ]

    // MARK: - Islands

    static let greenland: Outline = [
        (83,-33),(82,-22),(80,-18),(77,-18),(74,-20),(70,-22),(68,-25),(66,-34),(63,-41),
        (60,-43),(62,-49),(65,-52),(68,-52),(70,-54),(73,-56),(76,-60),(78,-68),(80,-65),
        (82,-50),(83,-40),
    ]

    static let baffin: Outline = [
        (73,-80),(72,-72),(70,-68),(68,-66),(66,-62),(63,-64),(62,-70),(64,-75),(67,-73),
        (69,-78),(71,-85),(73,-84),
    ]

    static let ellesmere: Outline = [(83,-70),(82,-62),(79,-71),(77,-78),(76,-88),(78,-90),(80,-85),(82,-80)]
    static let victoriaIsland: Outline = [(73,-115),(72,-105),(69,-101),(68,-107),(70,-115),(72,-118)]
    static let newfoundland: Outline = [(52,-56),(50,-53),(48,-53),(47,-54),(47,-59),(49,-58),(51,-57)]
    static let iceland: Outline = [(66,-23),(66,-16),(65,-14),(64,-14),(63,-19),(64,-22),(65,-24)]
    static let britishIsles: Outline = [
        (58,-3),(58,-2),(56,-2),(55,-1),(53,0),(52,2),(51,1),(50,-1),(50,-5),(51,-4),
        (53,-4),(55,-5),(56,-6),(57,-6),
    ]
    static let ireland: Outline = [(55,-7),(54,-6),(53,-6),(52,-6),(51,-9),(53,-10),(54,-10),(55,-8)]
    static let svalbard: Outline = [(80,12),(80,22),(78,22),(77,17),(78,11),(79,10)]
    static let novayaZemlya: Outline = [(77,68),(75,63),(72,55),(71,52),(70,57),(73,60),(75,66),(76,69)]
    static let sicily: Outline = [(38,13),(38,15),(37,15),(37,12)]
    static let sardinia: Outline = [(41,9),(41,10),(39,10),(39,9)]
    static let cuba: Outline = [(23,-84),(23,-81),(22,-79),(21,-77),(20,-74),(20,-77),(22,-82),(22,-85)]
    static let hispaniola: Outline = [(20,-74),(19,-69),(18,-68),(18,-72),(19,-74)]
    static let madagascar: Outline = [(-12,49),(-15,50),(-18,49),(-22,48),(-25,47),(-25,45),(-21,43),(-17,44),(-14,47)]
    static let sriLanka: Outline = [(9,80),(8,82),(6,81),(6,80),(8,79)]
    static let sumatra: Outline = [(6,95),(4,98),(1,104),(-2,106),(-6,106),(-6,103),(-3,100),(0,98),(3,96),(5,94)]
    static let java: Outline = [(-6,105),(-6,110),(-7,114),(-8,114),(-8,108),(-7,105)]
    static let borneo: Outline = [(7,117),(5,119),(1,118),(-3,116),(-4,114),(-2,110),(1,109),(2,110),(4,113),(7,115)]
    static let sulawesi: Outline = [(1,120),(0,123),(-2,121),(-5,120),(-5,119),(-2,119),(0,119)]
    static let newGuinea: Outline = [
        (-1,131),(-2,135),(-3,141),(-6,147),(-8,148),(-10,150),(-9,143),(-8,138),(-5,135),
        (-4,133),(-2,130),
    ]
    static let luzon: Outline = [(18,121),(16,122),(14,123),(13,121),(15,120),(17,120)]
    static let mindanao: Outline = [(9,126),(7,126),(6,125),(7,122),(9,123)]
    static let taiwan: Outline = [(25,121),(23,121),(22,120),(24,120)]
    static let hainan: Outline = [(20,110),(19,111),(18,110),(19,109)]
    static let japan: Outline = [
        (45,142),(44,145),(43,145),(41,141),(39,142),(36,141),(35,140),(34,137),(35,133),
        (34,131),(33,130),(31,130),(33,132),(35,135),(37,138),(39,140),(41,140),(43,141),
    ]
    static let sakhalin: Outline = [(54,142),(51,143),(48,143),(46,142),(48,142),(51,141),(53,141)]
    static let newZealandNorth: Outline = [(-34,173),(-37,176),(-39,177),(-41,175),(-40,173),(-38,174),(-36,174)]
    static let newZealandSouth: Outline = [(-41,174),(-43,173),(-46,170),(-47,168),(-45,167),(-43,170),(-41,172)]
    static let tasmania: Outline = [(-41,146),(-41,148),(-43,148),(-43,146),(-42,145)]

    // MARK: - Ice

    /// Antarctica's real coast, with the Peninsula reaching north to 63° and the Ross and
    /// Weddell embayments cut in — not a ring of constant latitude, which is what made it
    /// read as a circle stuck to the bottom of the planet.
    static let antarctica: Outline = [
        (-63,-57),(-66,-63),(-69,-67),(-71,-61),(-74,-60),(-77,-50),(-78,-40),(-76,-30),
        (-72,-20),(-70,-10),(-70,0),(-69,10),(-70,20),(-68,35),(-67,45),(-67,55),(-67,65),
        (-67,75),(-66,85),(-66,95),(-66,105),(-67,115),(-66,125),(-67,135),(-68,145),
        (-70,155),(-73,166),(-78,164),(-78,175),(-78,-170),(-77,-150),(-75,-140),
        (-74,-125),(-73,-110),(-73,-100),(-72,-90),(-70,-80),(-68,-72),(-66,-65),
    ]

    /// Sea ice over the Arctic Ocean, at roughly its average edge: down the east side of
    /// Greenland, up past Svalbard, back across the Beaufort. Deliberately ragged — a
    /// clean circle at a fixed latitude looked like a sticker rather than ice.
    static let arcticIce: Outline = [
        (80,-100),(78,-80),(82,-60),(84,-40),(82,-20),(80,0),(80,20),(78,35),(76,50),
        (78,65),(76,80),(77,100),(76,120),(74,140),(72,160),(72,180),(72,-170),(74,-155),
        (76,-140),(78,-125),(80,-110),
    ]

    static let land: [Outline] = [
        northAmerica, southAmerica, africa, eurasia, australia,
        baffin, ellesmere, victoriaIsland, newfoundland, iceland, britishIsles, ireland,
        svalbard, novayaZemlya, sicily, sardinia, cuba, hispaniola, madagascar, sriLanka,
        sumatra, java, borneo, sulawesi, newGuinea, luzon, mindanao, taiwan, hainan,
        japan, sakhalin, newZealandNorth, newZealandSouth, tasmania,
    ]

    /// Drawn white and drawn last, so the ice sheet sits on top of the rock it covers.
    static let ice: [Outline] = [antarctica, greenland, arcticIce]

    // MARK: - Resampling

    /// The same coasts, resampled to about two degrees a step, for the globe.
    ///
    /// The atlas is written coarsely — a dozen points for an island — and a coarse
    /// polygon projects badly at the horizon, where one long edge between two points that
    /// have both gone round the back cuts a chord clean across the face of the planet.
    /// Subdividing costs nothing, since it happens once, and it lets the rim-pinning in
    /// `Orthographic.onLimb` trace the horizon rather than leap over it.
    static let landDetailed: [Outline] = land.map(resampled)
    static let iceDetailed: [Outline] = ice.map(resampled)

    private static func resampled(_ outline: Outline) -> Outline {
        guard let first = outline.first else { return outline }
        var resampled: Outline = []
        let loop = outline + [first]
        for (a, b) in zip(loop, loop.dropFirst()) {
            let dLat = b.0 - a.0
            // The shorter way round, so an edge spanning the date line is a short hop
            // rather than a sweep back across every meridian there is.
            var dLon = (b.1 - a.1).truncatingRemainder(dividingBy: 360)
            if dLon > 180 { dLon -= 360 } else if dLon < -180 { dLon += 360 }
            let east = abs(dLon) * cos(a.0 * .pi / 180)
            let steps = max(1, Int((max(abs(dLat), east) / 2).rounded(.up)))
            for step in 0..<steps {
                let t = Double(step) / Double(steps)
                resampled.append((a.0 + dLat * t, a.1 + dLon * t))
            }
        }
        return resampled
    }
}

/// The sphere itself: land, ice, your lap around it, and the places it passes.
struct GlobeSphere: View {
    @Environment(\.colorScheme) private var scheme

    var route: [CLLocationCoordinate2D]
    /// How far round the lap you have got, 0–1. The whole route is drawn dashed; this
    /// much of it is drawn again in red on top.
    var progress: Double = 0
    var origin: CLLocationCoordinate2D?
    var here: CLLocationCoordinate2D?
    var landmarks: [Landmark]
    /// The one you reach next, drawn larger and named.
    var highlight: Landmark?
    /// Where the viewer is over. Owned by the parent so the drag can move it.
    var centreLat: Double
    var centreLon: Double

    var body: some View {
        Canvas(rendersAsynchronously: false) { context, size in
            let radius = min(size.width, size.height) / 2 - 2
            let middle = CGPoint(x: size.width / 2, y: size.height / 2)
            let projection = Orthographic(centreLat: centreLat, centreLon: centreLon,
                                          radius: radius, centre: middle)
            let globe = Path(ellipseIn: CGRect(x: middle.x - radius, y: middle.y - radius,
                                               width: radius * 2, height: radius * 2))
            // The sun, off to the upper left. Everything that gives the disc its volume —
            // the lit water, the falling-away limb — is measured from here.
            let light = CGPoint(x: middle.x - radius * 0.34, y: middle.y - radius * 0.34)

            context.fill(globe, with: .radialGradient(
                Gradient(colors: [oceanLit, ocean, oceanDeep]),
                center: light, startRadius: 0, endRadius: radius * 1.7))
            // Everything else is clipped to the disc, so a polygon that straddles the
            // horizon cannot spill into the space around the planet.
            context.clip(to: globe)

            for (outlines, fill, edge) in [(GlobeAtlas.landDetailed, land, landEdge),
                                           (GlobeAtlas.iceDetailed, ice, iceEdge)] {
                for outline in outlines {
                    guard let path = filled(outline, projection) else { continue }
                    context.fill(path, with: .color(fill))
                    context.stroke(path, with: .color(edge), lineWidth: 0.6)
                }
            }

            // Limb darkening, over the coastlines rather than under them: the planet
            // turns away from the light at its edge, and the land has to turn with it.
            context.fill(globe, with: .radialGradient(
                Gradient(stops: [
                    .init(color: .black.opacity(0), location: 0),
                    .init(color: .black.opacity(0.06), location: 0.55),
                    .init(color: .black.opacity(0.42), location: 1),
                ]),
                center: light, startRadius: 0, endRadius: radius * 1.6))

            if route.count > 1 {
                let coordinates = route.map { ($0.latitude, $0.longitude) }
                // The whole lap, dashed: the route you would take, not the route you have
                // taken. Black reads against both the lit water and the darkened limb.
                for run in visibleRuns(coordinates, projection) where run.count > 1 {
                    context.stroke(line(run), with: .color(.black.opacity(0.85)),
                                   style: StrokeStyle(lineWidth: 2, lineCap: .round,
                                                      lineJoin: .round, dash: [5, 4]))
                }
                // And how far round you have actually got, over the top of it.
                let travelled = Int((Double(route.count - 1) * max(0, min(1, progress))).rounded()) + 1
                if travelled > 1 {
                    for run in visibleRuns(Array(coordinates.prefix(travelled)), projection) where run.count > 1 {
                        context.stroke(line(run), with: .color(Self.travelled),
                                       style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                    }
                }
            }

            for landmark in landmarks where landmark != highlight {
                let projected = projection.project(landmark.lat, landmark.lon)
                guard projected.visible else { continue }
                context.fill(dot(at: projected.point, radius: 3), with: .color(.white))
                context.stroke(dot(at: projected.point, radius: 3), with: .color(.black.opacity(0.55)), lineWidth: 1.2)
            }

            // The one you reach next, named on the sphere so the note underneath has
            // something to point at.
            if let highlight {
                let projected = projection.project(highlight.lat, highlight.lon)
                if projected.visible {
                    let accent = DashboardTheme.shared.accent
                    context.stroke(dot(at: projected.point, radius: 9), with: .color(accent.opacity(0.45)), lineWidth: 2)
                    context.fill(dot(at: projected.point, radius: 4.5), with: .color(accent))
                    context.stroke(dot(at: projected.point, radius: 4.5), with: .color(.white), lineWidth: 2)

                    var label = context.resolve(Text(highlight.name)
                        .font(.system(size: 10, weight: .semibold)))
                    label.shading = .color(.white)
                    let size = label.measure(in: CGSize(width: 160, height: 40))
                    // Flipped to the other side rather than allowed off the edge of the
                    // disc, which is where the interesting landmarks tend to sit.
                    let toTheRight = projected.point.x + 14 + size.width < radius * 2
                    let anchor = CGPoint(x: projected.point.x + (toTheRight ? 13 : -13), y: projected.point.y)
                    context.draw(context.resolve(Text(highlight.name)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.black.opacity(0.5))),
                        at: CGPoint(x: anchor.x + 0.7, y: anchor.y + 0.7),
                        anchor: toTheRight ? .leading : .trailing)
                    context.draw(label, at: anchor, anchor: toTheRight ? .leading : .trailing)
                }
            }

            // Where you have got to.
            if let here {
                let projected = projection.project(here.latitude, here.longitude)
                if projected.visible {
                    context.fill(dot(at: projected.point, radius: 6), with: .color(Self.youAreHere))
                    context.stroke(dot(at: projected.point, radius: 6), with: .color(.white), lineWidth: 2.5)
                }
            }

            // Start and finish are the same place — it is a loop — so one flag does for
            // both.
            if let origin {
                let projected = projection.project(origin.latitude, origin.longitude)
                if projected.visible { flag(&context, at: projected.point) }
            }

            // A hairline of lit atmosphere along the rim, which is what stops the disc
            // from looking like a sticker.
            context.stroke(globe, with: .color(.white.opacity(0.3)), lineWidth: 1.5)
        }
        .background(Circle().fill(ocean))
        .clipShape(Circle())
        .background(
            Circle()
                .fill(DashboardTheme.shared.accent.opacity(0.22))
                .blur(radius: 14)
                .scaleEffect(1.04)
        )
    }

    private var ocean: Color { scheme == .dark ? Color(hex: 0x11508F) : Color(hex: 0x2183CE) }
    private var oceanLit: Color { scheme == .dark ? Color(hex: 0x2A7CC4) : Color(hex: 0x49AEE8) }
    private var oceanDeep: Color { scheme == .dark ? Color(hex: 0x062F5C) : Color(hex: 0x11497E) }
    private var land: Color { scheme == .dark ? Color(hex: 0x2F9457) : Color(hex: 0x46BF6B) }
    private var landEdge: Color { scheme == .dark ? Color(hex: 0x1E6B3C) : Color(hex: 0x2E8F4E) }
    private var ice: Color { scheme == .dark ? Color(hex: 0xE4EDF5) : Color(hex: 0xF7FBFF) }
    private var iceEdge: Color { scheme == .dark ? Color(hex: 0xB9CBDC) : Color(hex: 0xCFE1F0) }

    /// Distance covered, and the dot for where that leaves you. Fixed rather than themed:
    /// red means the part behind you and blue means you, whatever the dashboard's colour.
    static let travelled = Color(hex: 0xE2342B)
    static let youAreHere = Color(hex: 0x6FD0F5)

    private func dot(at point: CGPoint, radius: CGFloat) -> Path {
        Path(ellipseIn: CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2))
    }

    private func line(_ points: [CGPoint]) -> Path {
        var path = Path()
        guard let first = points.first else { return path }
        path.move(to: first)
        for point in points.dropFirst() { path.addLine(to: point) }
        return path
    }

    /// The chequered flag, drawn rather than borrowed from a symbol: at fourteen points
    /// tall the squares have to land on whole pixels to read as a chequerboard at all.
    private func flag(_ context: inout GraphicsContext, at point: CGPoint) {
        let cell: CGFloat = 4, columns = 4, rows = 2, height: CGFloat = 16
        var pole = Path()
        pole.move(to: point)
        pole.addLine(to: CGPoint(x: point.x, y: point.y - height))
        context.stroke(pole, with: .color(.black), lineWidth: 1.5)
        context.fill(dot(at: point, radius: 2), with: .color(.black))

        let corner = CGPoint(x: point.x + 0.75, y: point.y - height)
        for row in 0..<rows {
            for column in 0..<columns {
                let square = CGRect(x: corner.x + CGFloat(column) * cell, y: corner.y + CGFloat(row) * cell,
                                    width: cell, height: cell)
                context.fill(Path(square), with: .color((row + column).isMultiple(of: 2) ? .white : .black))
            }
        }
        context.stroke(Path(CGRect(x: corner.x, y: corner.y,
                                   width: CGFloat(columns) * cell, height: CGFloat(rows) * cell)),
                       with: .color(.black), lineWidth: 0.75)
    }

    /// A closed coastline, with whatever has gone round the back pinned to the rim, or
    /// nil for a coast that is wholly on the far side.
    ///
    /// The nil case is not an optimisation. An outline that encircles a pole — Antarctica,
    /// the Arctic ice — pins to points all the way round the rim when it is entirely
    /// hidden, and a closed path all the way round the rim encloses the whole disc: turn
    /// the globe to look at the north pole and the planet went solid white. Nothing
    /// visible has to mean nothing drawn.
    private func filled(_ outline: [(Double, Double)], _ projection: Orthographic) -> Path? {
        var path = Path()
        var anyVisible = false
        for (index, coordinate) in outline.enumerated() {
            let projected = projection.project(coordinate.0, coordinate.1)
            anyVisible = anyVisible || projected.visible
            let point = projected.visible ? projected.point
                                          : projection.onLimb(coordinate.0, coordinate.1)
            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        guard anyVisible else { return nil }
        path.closeSubpath()
        return path
    }

    /// Splits a line of coordinates into the stretches that are on the near side. A run
    /// ends the moment a point goes round the back, which is what stops a route from
    /// drawing a chord straight across the face of the globe. Only for lines: a filled
    /// shape wants `filled(_:_:)`, which keeps the hidden part on the rim instead of
    /// dropping it.
    private func visibleRuns(_ coordinates: [(Double, Double)],
                             _ projection: Orthographic) -> [[CGPoint]] {
        var runs: [[CGPoint]] = []
        var current: [CGPoint] = []
        for (lat, lon) in coordinates {
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
}


/// A flat world, for a route that goes round the whole planet.
///
/// MapKit cannot help here: it will not zoom out far enough to show the entire globe in
/// a card two inches tall, so the equator's route — which spans every degree of longitude
/// there is — came out as a close-up of the South Atlantic with both ends off-screen. An
/// equirectangular projection of the same outlines the globe uses has no such limit, and
/// puts the line exactly where it belongs: straight across the middle.
struct FlatWorldMap: View {
    @Environment(\.colorScheme) private var scheme

    /// The route, in (latitude, longitude).
    var route: [CLLocationCoordinate2D]
    /// How many times over, which decides how many lines are traced and in what colours.
    var laps: Double
    var animate: Bool

    private static let maxDrawnLaps = 6
    private var drawn: Int { min(Self.maxDrawnLaps, max(1, Int(laps.rounded(.up)))) }

    private func colour(_ index: Int) -> Color {
        guard drawn > 1 else { return Color(hue: 0.33, saturation: 0.95, brightness: 0.62) }
        let t = Double(index) / Double(drawn - 1)
        return Color(hue: 0.33 * (1 - t), saturation: 0.95, brightness: 0.68)
    }

    private func portion(_ index: Int) -> Double { max(0, min(1, laps - Double(index))) }

    var body: some View {
        // No GeometryReader needed: the Canvas is handed its size and the route Shape is
        // handed its rect, and both project from what they are given.
        ZStack {
            Canvas(rendersAsynchronously: false) { context, size in
                context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(ocean))
                for outline in GlobeAtlas.land {
                    let path = closed(outline, size)
                    context.fill(path, with: .color(land))
                    context.stroke(path, with: .color(landEdge), lineWidth: 0.5)
                }
                for outline in GlobeAtlas.ice {
                    if wrapsPole(outline) {
                        // No outline stroke on a cap: it is drawn three times over to
                        // cover the seam, and the strokes would show as vertical scars.
                        context.fill(cap(outline, size), with: .color(ice))
                    } else {
                        let path = closed(outline, size)
                        context.fill(path, with: .color(ice))
                        context.stroke(path, with: .color(iceEdge), lineWidth: 0.5)
                    }
                }
            }
            // The line itself is a Shape rather than Canvas drawing, because only a
            // Shape can be trimmed — and the tracing is the point.
            //
            // Cased in white underneath, the way a road is drawn on a map: the route runs
            // along the equator, which is mostly over land, and a green line on green
            // ground is a line you have to hunt for.
            ForEach(0..<drawn, id: \.self) { index in
                let line = FlatRoute(route: route).trim(from: 0, to: animate ? portion(index) : 0)
                ZStack {
                    line.stroke(.white.opacity(0.9), style: StrokeStyle(lineWidth: 5.5, lineCap: .round))
                    line.stroke(colour(index), style: StrokeStyle(lineWidth: 3, lineCap: .round))
                }
                .animation(.easeInOut(duration: 0.9).delay(Double(index) * 0.18), value: animate)
            }
        }
    }

    /// Equirectangular: longitude straight onto x, latitude straight onto y. The
    /// distortion at the poles does not matter for a picture whose subject is a line
    /// around the equator.
    private func project(_ lat: Double, _ lon: Double, _ size: CGSize) -> CGPoint {
        CGPoint(x: (lon + 180) / 360 * size.width, y: (90 - lat) / 180 * size.height)
    }

    private func closed(_ outline: GlobeAtlas.Outline, _ size: CGSize) -> Path {
        var path = Path()
        let points = outline.map { project($0.0, $0.1, size) }
        guard let first = points.first else { return path }
        path.move(to: first)
        for point in points.dropFirst() { path.addLine(to: point) }
        path.closeSubpath()
        return path
    }

    /// An outline that encircles a pole is a ring on the sphere but a band on a flat
    /// map: laid out left to right and closed along the top or bottom edge, rather than
    /// joined end to end across the whole width.
    private func wrapsPole(_ outline: GlobeAtlas.Outline) -> Bool {
        let longitudes = outline.map(\.1)
        guard let low = longitudes.min(), let high = longitudes.max() else { return false }
        return high - low > 300
    }

    /// A pole's ice as a band across the map, built from how far the ice reaches in each
    /// strip of longitude rather than by tracing the coast point by point.
    ///
    /// Tracing fails twice over. The outline closes on itself across the date line, so
    /// the two ends leave a seam; and where a coast doubles back on itself — the Antarctic
    /// Peninsula runs north, then south again — the traced loop reverses its own winding
    /// and punches a slot of open water through the ice. An outer edge, one latitude per
    /// strip, can do neither, and still keeps the peninsula as the bump it is.
    private func cap(_ outline: GlobeAtlas.Outline, _ size: CGSize) -> Path {
        let southern = (outline.map(\.0).reduce(0, +) / Double(outline.count)) < 0
        let strips = 90
        var reach = [Double?](repeating: nil, count: strips)
        for (lat, lon) in outline {
            let index = min(strips - 1, max(0, Int((lon + 180) / 360 * Double(strips))))
            reach[index] = reach[index].map { southern ? max($0, lat) : min($0, lat) } ?? lat
        }
        // A strip the outline happened to step over borrows from the one before it, twice
        // round so a run of them fills in across the date line as well.
        for _ in 0..<2 {
            for index in 0..<strips where reach[index] == nil {
                reach[index] = reach[(index + strips - 1) % strips]
            }
        }
        guard let fallback = reach.compactMap({ $0 }).first else { return Path() }

        let y = { (lat: Double) in (90 - lat) / 180 * size.height }
        let edge = southern ? size.height : 0
        var path = Path()
        path.move(to: CGPoint(x: 0, y: edge))
        path.addLine(to: CGPoint(x: 0, y: y(reach[0] ?? fallback)))
        for index in 0..<strips {
            path.addLine(to: CGPoint(x: (Double(index) + 0.5) / Double(strips) * size.width,
                                     y: y(reach[index] ?? fallback)))
        }
        path.addLine(to: CGPoint(x: size.width, y: y(reach[strips - 1] ?? fallback)))
        path.addLine(to: CGPoint(x: size.width, y: edge))
        path.closeSubpath()
        return path
    }

    // Pitched to sit beside the other journey cards, which are real Apple Maps: pale
    // green ground, light blue water. The globe can be vibrant because nothing is drawn
    // on top of it; this map has a green line running the width of it.
    private var ocean: Color { scheme == .dark ? Color(hex: 0x123B58) : Color(hex: 0x9FD4F2) }
    private var land: Color { scheme == .dark ? Color(hex: 0x3E5C3B) : Color(hex: 0xCFE8B4) }
    private var landEdge: Color { scheme == .dark ? Color(hex: 0x2E4A2C) : Color(hex: 0xAFD292) }
    private var ice: Color { scheme == .dark ? Color(hex: 0xE8F0F6) : Color(hex: 0xFFFFFF) }
    private var iceEdge: Color { scheme == .dark ? Color(hex: 0xB8C8D6) : Color(hex: 0xD6E4EF) }
}

/// The route as a trimmable Shape. Split where the line crosses the date line, so it
/// does not draw a stripe back across the whole map.
private struct FlatRoute: Shape {
    var route: [CLLocationCoordinate2D]

    func path(in rect: CGRect) -> Path {
        // Projected from the rect the shape is handed, rather than from a closure passed
        // in: a Shape must be Sendable, and a captured function is not.
        func project(_ lat: Double, _ lon: Double) -> CGPoint {
            CGPoint(x: rect.minX + (lon + 180) / 360 * rect.width,
                    y: rect.minY + (90 - lat) / 180 * rect.height)
        }
        var path = Path()
        var started = false
        var previousLon: Double?
        for coordinate in route {
            let point = project(coordinate.latitude, coordinate.longitude)
            if let previousLon, abs(coordinate.longitude - previousLon) > 180 {
                started = false   // wrapped the date line; start a new stretch
            }
            if started { path.addLine(to: point) } else { path.move(to: point); started = true }
            previousLon = coordinate.longitude
        }
        return path
    }
}
