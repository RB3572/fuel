import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// Renders the Health Logger app icon at 1024pt:
//
//   swift makeicon.swift Assets.xcassets/AppIcon.appiconset/icon-1024.png
//
// A pink heart on white with an export arrow rising out of it: health data, leaving for
// wherever you send it.
//
// The heart is wider than it is tall (0.83 x 0.77 of its box) with a short tip. The
// obvious construction — a tall box and a long tapering point — reads as a heart that
// has been stretched vertically, which is what it is.
//
// Colour is a deep rose falling to a light pink, lit by one broad soft highlight in the
// upper left. That highlight is what makes it matte rather than glossy: gloss is a small
// hard specular with a defined edge, so this is deliberately the opposite — large, low
// opacity, fading to nothing well before the edges.

let size: CGFloat = 1024
let white = CGColor(red: 1, green: 1, blue: 1, alpha: 1)
let deepPink = CGColor(red: 0.729, green: 0.078, blue: 0.318, alpha: 1)  // #BA1451
let lightPink = CGColor(red: 0.988, green: 0.549, blue: 0.706, alpha: 1)  // #FC8CB4

let space = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: Int(size), height: Int(size), bitsPerComponent: 8,
                    bytesPerRow: 0, space: space,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!

// Work in y-down coordinates, like SVG.
ctx.translateBy(x: 0, y: size)
ctx.scaleBy(x: 1, y: -1)

ctx.setFillColor(white)
ctx.fill(CGRect(x: 0, y: 0, width: size, height: size))

let s = size
let box = s * 0.82          // the heart's unit box
let cx = s * 0.5
let cy = s * 0.5

// Unit coordinates (0…1, y-down) mapped into a box centred on the icon. The 0.507
// offset centres the heart's ink rather than its bounding box.
func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
    CGPoint(x: cx + (x - 0.5) * box, y: cy + (y - 0.507) * box)
}

// Spans 0.083…0.917 wide by 0.125…0.890 tall — broad shoulders, short tip.
let heart = CGMutablePath()
heart.move(to: p(0.5000, 0.8896))
heart.addLine(to: p(0.4396, 0.8346))
heart.addCurve(to: p(0.0833, 0.3542), control1: p(0.2250, 0.6400), control2: p(0.0833, 0.5117))
heart.addCurve(to: p(0.3125, 0.1250), control1: p(0.0833, 0.2258), control2: p(0.1842, 0.1250))
heart.addCurve(to: p(0.5000, 0.2121), control1: p(0.3850, 0.1250), control2: p(0.4546, 0.1588))
heart.addCurve(to: p(0.6875, 0.1250), control1: p(0.5454, 0.1588), control2: p(0.6150, 0.1250))
heart.addCurve(to: p(0.9167, 0.3542), control1: p(0.8158, 0.1250), control2: p(0.9167, 0.2258))
heart.addCurve(to: p(0.5604, 0.8350), control1: p(0.9167, 0.5117), control2: p(0.7750, 0.6400))
heart.closeSubpath()

ctx.saveGState()
ctx.addPath(heart)
ctx.clip()

// Body: deep rose at the top falling to light pink at the bottom.
let body = CGGradient(colorsSpace: space, colors: [deepPink, lightPink] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(body, start: p(0.5, 0.05), end: p(0.5, 0.95),
                       options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])

// Matte sheen: one broad diffuse highlight, no hard edge anywhere.
let sheenColors = [
    CGColor(red: 1, green: 1, blue: 1, alpha: 0.20),
    CGColor(red: 1, green: 1, blue: 1, alpha: 0.06),
    CGColor(red: 1, green: 1, blue: 1, alpha: 0.0),
] as CFArray
let sheen = CGGradient(colorsSpace: space, colors: sheenColors, locations: [0, 0.45, 1])!
ctx.drawRadialGradient(sheen,
                       startCenter: p(0.30, 0.40), startRadius: 0,
                       endCenter: p(0.30, 0.40), endRadius: box * 0.55,
                       options: [])
ctx.restoreGState()

// The export mark, in white: an arrow lifting off a baseline.
ctx.setStrokeColor(white)
ctx.setLineWidth(s * 0.052)
ctx.setLineCap(.round)
ctx.setLineJoin(.round)

let shaft = CGMutablePath()
shaft.move(to: p(0.50, 0.655))
shaft.addLine(to: p(0.50, 0.325))
ctx.addPath(shaft)
ctx.strokePath()

let head = CGMutablePath()
head.move(to: p(0.345, 0.470))
head.addLine(to: p(0.500, 0.315))
head.addLine(to: p(0.655, 0.470))
ctx.addPath(head)
ctx.strokePath()

// Kept narrow so it stays inside the heart, which tapers below the midline.
let base = CGMutablePath()
base.move(to: p(0.385, 0.725))
base.addLine(to: p(0.615, 0.725))
ctx.addPath(base)
ctx.strokePath()

let image = ctx.makeImage()!
let out = URL(fileURLWithPath: CommandLine.arguments[1])
let destination = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, image, nil)
CGImageDestinationFinalize(destination)
print("wrote \(out.path)")
