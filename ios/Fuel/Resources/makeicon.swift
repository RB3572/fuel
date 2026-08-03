import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// Renders the Fuel app icon at 1024pt:
//
//   swift makeicon.swift Assets.xcassets/AppIcon.appiconset/icon-1024.png
//
// Same family as Health Logger — a single mark on white, filled with a vertical
// gradient and lit by one broad soft highlight — so the two apps read as siblings on a
// home screen. Here the mark is a lightning bolt and the gradient runs fire: deep red
// at the top down to a bright amber at the bottom.
//
// The highlight is what keeps it matte. Gloss is a small hard specular with a defined
// edge; this is the opposite — large, low opacity, fading out before the edges.

let size: CGFloat = 1024
let white = CGColor(red: 1, green: 1, blue: 1, alpha: 1)
let deepRed = CGColor(red: 0.741, green: 0.078, blue: 0.043, alpha: 1)   // #BD140B
let fireOrange = CGColor(red: 0.949, green: 0.325, blue: 0.106, alpha: 1) // #F2531B
let brightAmber = CGColor(red: 1.0, green: 0.667, blue: 0.129, alpha: 1) // #FFAA21

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
let box = s * 0.72
let cx = s * 0.5
let cy = s * 0.5

// Unit coordinates (0…1, y-down) mapped into a box centred on the icon.
func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
    CGPoint(x: cx + (x - 0.5) * box, y: cy + (y - 0.5) * box)
}

// A bolt with enough width in each limb to survive being shrunk to 60pt. The two
// diagonals are parallel, which keeps it looking drawn rather than improvised.
let bolt = CGMutablePath()
bolt.addLines(between: [
    p(0.66, 0.02),
    p(0.17, 0.575),
    p(0.44, 0.575),
    p(0.34, 0.98),
    p(0.83, 0.425),
    p(0.56, 0.425),
])
bolt.closeSubpath()

ctx.saveGState()
ctx.addPath(bolt)
ctx.clip()

// Three stops, so the top stays unmistakably red instead of washing straight to orange.
let body = CGGradient(colorsSpace: space, colors: [deepRed, fireOrange, brightAmber] as CFArray,
                      locations: [0, 0.62, 1])!
ctx.drawLinearGradient(body, start: p(0.5, 0.12), end: p(0.5, 1.02),
                       options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])

let sheenColors = [
    CGColor(red: 1, green: 1, blue: 1, alpha: 0.22),
    CGColor(red: 1, green: 1, blue: 1, alpha: 0.07),
    CGColor(red: 1, green: 1, blue: 1, alpha: 0.0),
] as CFArray
let sheen = CGGradient(colorsSpace: space, colors: sheenColors, locations: [0, 0.45, 1])!
ctx.drawRadialGradient(sheen,
                       startCenter: p(0.30, 0.38), startRadius: 0,
                       endCenter: p(0.30, 0.38), endRadius: box * 0.55,
                       options: [])
ctx.restoreGState()

let image = ctx.makeImage()!
let out = URL(fileURLWithPath: CommandLine.arguments[1])
let destination = CGImageDestinationCreateWithURL(out as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, image, nil)
CGImageDestinationFinalize(destination)
print("wrote \(out.path)")
