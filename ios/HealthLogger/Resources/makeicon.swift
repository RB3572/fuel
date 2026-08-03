import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// Renders the Health Logger app icon at 1024pt.
// A pink heart on white, with an export arrow rising out of it: health data, leaving
// for wherever you send it. The arrow is knocked out of the heart in white so the mark
// stays two flat colours and survives being shrunk to a home-screen icon.

let size: CGFloat = 1024
let white = CGColor(red: 1, green: 1, blue: 1, alpha: 1)
let pinkTop = CGColor(red: 1.0, green: 0.42, blue: 0.60, alpha: 1)     // #FF6B99
let pinkBottom = CGColor(red: 0.98, green: 0.20, blue: 0.42, alpha: 1) // #FA336B

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
let cx = s * 0.5
let cy = s * 0.505
let h = s * 0.66

// A unit-box heart (0…1, y-down), mapped into a centred box of side `h`.
func u(_ x: CGFloat) -> CGFloat { cx + (x - 0.5) * h }
func v(_ y: CGFloat) -> CGFloat { cy + (y - 0.5) * h }
func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: u(x), y: v(y)) }

let heart = CGMutablePath()
heart.move(to: p(0.50, 0.94))
heart.addCurve(to: p(0.26, 0.10), control1: p(0.06, 0.58), control2: p(0.02, 0.22))
heart.addCurve(to: p(0.50, 0.28), control1: p(0.42, 0.02), control2: p(0.50, 0.14))
heart.addCurve(to: p(0.74, 0.10), control1: p(0.50, 0.14), control2: p(0.58, 0.02))
heart.addCurve(to: p(0.50, 0.94), control1: p(0.98, 0.22), control2: p(0.94, 0.58))
heart.closeSubpath()

ctx.saveGState()
ctx.addPath(heart)
ctx.clip()
let gradient = CGGradient(colorsSpace: space, colors: [pinkTop, pinkBottom] as CFArray, locations: [0, 1])!
ctx.drawLinearGradient(gradient, start: CGPoint(x: 0, y: v(0.0)), end: CGPoint(x: 0, y: v(1.0)), options: [])
ctx.restoreGState()

// The export mark, in white: an arrow leaving through the top, standing on an open
// tray — the same idea as the system share glyph, sized to read at 60pt.
ctx.setStrokeColor(white)
ctx.setLineWidth(s * 0.055)
ctx.setLineCap(.round)
ctx.setLineJoin(.round)

let shaft = CGMutablePath()
shaft.move(to: p(0.50, 0.66))
shaft.addLine(to: p(0.50, 0.30))
ctx.addPath(shaft)
ctx.strokePath()

let head = CGMutablePath()
head.move(to: p(0.33, 0.46))
head.addLine(to: p(0.50, 0.29))
head.addLine(to: p(0.67, 0.46))
ctx.addPath(head)
ctx.strokePath()

// A short baseline the arrow lifts off from. Kept narrow so it stays inside the
// heart, which tapers fast below the midline.
let base = CGMutablePath()
base.move(to: p(0.37, 0.74))
base.addLine(to: p(0.63, 0.74))
ctx.addPath(base)
ctx.strokePath()

let image = ctx.makeImage()!
let out = URL(fileURLWithPath: CommandLine.arguments[1])
let destination = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, image, nil)
CGImageDestinationFinalize(destination)
print("wrote \(out.path)")
