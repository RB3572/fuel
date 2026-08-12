import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// Renders Google's four-colour "G" for the sign-in button:
//
//   swift makegoogleg.swift Assets.xcassets/GoogleG.imageset/google-g.png
//
// The official mark, drawn from Google's own 48×48 path data rather than approximated,
// because a hand-drawn near-miss of someone else's logo looks worse than no logo and
// their branding guidelines require the real one. Four subpaths, one per colour, each
// a slice of the ring plus the crossbar.
//
// Rendered to a PNG rather than parsed at runtime: the shape never changes, and an SVG
// path parser in the app would be a hundred lines of nothing.

let size: CGFloat = 240
let scale = size / 48   // the source artwork is a 48×48 viewBox

let blue = CGColor(red: 0.259, green: 0.522, blue: 0.957, alpha: 1)   // #4285F4
let green = CGColor(red: 0.204, green: 0.659, blue: 0.325, alpha: 1)  // #34A853
let yellow = CGColor(red: 0.984, green: 0.737, blue: 0.020, alpha: 1) // #FBBC05
let red = CGColor(red: 0.918, green: 0.263, blue: 0.208, alpha: 1)    // #EA4335

let space = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: Int(size), height: Int(size), bitsPerComponent: 8,
                    bytesPerRow: 0, space: space,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!

// Work in the artwork's y-down coordinates.
ctx.translateBy(x: 0, y: size)
ctx.scaleBy(x: 1, y: -1)
ctx.scaleBy(x: scale, y: scale)

func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: x, y: y) }

// Blue: the right-hand arc and the crossbar.
let bluePath = CGMutablePath()
bluePath.move(to: p(45.12, 24.5))
bluePath.addCurve(to: p(44.72, 20.0), control1: p(45.12, 22.94), control2: p(44.98, 21.44))
bluePath.addLine(to: p(24.0, 20.0))
bluePath.addLine(to: p(24.0, 28.51))
bluePath.addLine(to: p(35.84, 28.51))
bluePath.addCurve(to: p(31.45, 35.15), control1: p(35.33, 31.26), control2: p(33.78, 33.59))
bluePath.addLine(to: p(31.45, 40.67))
bluePath.addLine(to: p(38.56, 40.67))
bluePath.addCurve(to: p(45.12, 24.5), control1: p(42.72, 36.84), control2: p(45.12, 31.2))
bluePath.closeSubpath()

// Green: the bottom arc.
let greenPath = CGMutablePath()
greenPath.move(to: p(24.0, 46.0))
greenPath.addCurve(to: p(38.56, 40.67), control1: p(29.94, 46.0), control2: p(34.92, 44.03))
greenPath.addLine(to: p(31.45, 35.15))
greenPath.addCurve(to: p(24.0, 37.25), control1: p(29.48, 36.47), control2: p(26.96, 37.25))
greenPath.addCurve(to: p(11.69, 28.18), control1: p(18.27, 37.25), control2: p(13.42, 33.38))
greenPath.addLine(to: p(4.34, 28.18))
greenPath.addLine(to: p(4.34, 33.88))
greenPath.addCurve(to: p(24.0, 46.0), control1: p(7.96, 41.07), control2: p(15.4, 46.0))
greenPath.closeSubpath()

// Yellow: the left arc. The source uses a smooth-curve shorthand; the reflected control
// points are written out here so nothing has to infer them.
let yellowPath = CGMutablePath()
yellowPath.move(to: p(11.69, 28.18))
yellowPath.addCurve(to: p(11.0, 24.0), control1: p(11.25, 26.86), control2: p(11.0, 25.45))
yellowPath.addCurve(to: p(11.69, 19.82), control1: p(11.0, 22.55), control2: p(11.25, 21.14))
yellowPath.addLine(to: p(11.69, 14.12))
yellowPath.addLine(to: p(4.34, 14.12))
yellowPath.addCurve(to: p(2.0, 24.0), control1: p(2.85, 17.09), control2: p(2.0, 20.45))
yellowPath.addCurve(to: p(4.34, 33.88), control1: p(2.0, 27.55), control2: p(2.85, 30.91))
yellowPath.addLine(to: p(11.69, 28.18))
yellowPath.closeSubpath()

// Red: the top arc.
let redPath = CGMutablePath()
redPath.move(to: p(24.0, 10.75))
redPath.addCurve(to: p(32.41, 14.04), control1: p(27.23, 10.75), control2: p(30.13, 11.86))
redPath.addLine(to: p(38.72, 7.73))
redPath.addCurve(to: p(24.0, 2.0), control1: p(34.91, 4.18), control2: p(29.93, 2.0))
redPath.addCurve(to: p(4.34, 14.12), control1: p(15.4, 2.0), control2: p(7.96, 6.93))
redPath.addLine(to: p(11.69, 19.82))
redPath.addCurve(to: p(24.0, 10.75), control1: p(13.42, 14.62), control2: p(18.27, 10.75))
redPath.closeSubpath()

for (path, color) in [(bluePath, blue), (greenPath, green), (yellowPath, yellow), (redPath, red)] {
    ctx.addPath(path)
    ctx.setFillColor(color)
    ctx.fillPath()
}

let image = ctx.makeImage()!
let out = URL(fileURLWithPath: CommandLine.arguments[1])
let destination = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, image, nil)
CGImageDestinationFinalize(destination)
print("wrote \(out.path)")
