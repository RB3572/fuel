import SwiftUI
import WidgetKit

// The drawing vocabulary every Fuel widget is built from: soft rounded bubbles, thick
// rounded rings, and capsule bars. It is the app's language shrunk to widget size —
// nothing here draws a sharp corner or a hairline, because at 150 points neither reads.
//
// Every color comes from the snapshot's palette, which is whatever the user picked in
// Dashboard colors. Nothing below hardcodes a hue.

struct FuelEntry: TimelineEntry {
    var date: Date
    var snapshot: FuelWidgetSnapshot
    var stale: Bool = false
}

struct FuelProvider: TimelineProvider {
    func placeholder(in context: Context) -> FuelEntry {
        FuelEntry(date: Date(), snapshot: .placeholder)
    }

    func getSnapshot(in context: Context, completion: @escaping (FuelEntry) -> Void) {
        completion(entry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<FuelEntry>) -> Void) {
        // The app rewrites the snapshot and reloads timelines whenever it syncs, so this
        // interval is only the floor for a phone that has not opened Fuel in a while.
        let next = Calendar.current.date(byAdding: .minute, value: 20, to: Date()) ?? Date()
        completion(Timeline(entries: [entry()], policy: .after(next)))
    }

    private func entry() -> FuelEntry {
        guard let snapshot = FuelWidgetStore.load() else {
            // No snapshot means the app has never finished a sync on this device. Show
            // the sample rather than an empty rectangle, but mark it so the widget can
            // say so instead of quietly showing numbers that are not the user's.
            return FuelEntry(date: Date(), snapshot: .placeholder, stale: true)
        }
        return FuelEntry(date: Date(), snapshot: snapshot)
    }
}

// MARK: - Containers

/// The soft tile everything sits in. `containerBackground` is what lets iOS place the
/// widget on the Home Screen, in StandBy and on the Lock Screen without redrawing it.
struct Bubble<Content: View>: View {
    var palette: FuelWidgetPalette
    @ViewBuilder var content: Content

    var body: some View {
        content
            .containerBackground(for: .widget) {
                LinearGradient(colors: [palette.accent.opacity(0.16), palette.accent.opacity(0.04)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
            }
    }
}

struct WidgetTitle: View {
    var text: String
    var palette: FuelWidgetPalette
    var trailing: String?

    var body: some View {
        HStack(spacing: 4) {
            Text(text.uppercased())
                .font(.system(size: 9, weight: .heavy))
                .tracking(0.6)
                .foregroundStyle(palette.accent)
            Spacer(minLength: 2)
            if let trailing {
                Text(trailing)
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// A dot-and-label pair, the widget-sized version of the legend on the Today cards.
struct KeyDot: View {
    var color: Color
    var label: String
    var value: String

    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(label).font(.system(size: 10)).foregroundStyle(.secondary)
            Spacer(minLength: 2)
            Text(value).font(.system(size: 10, weight: .semibold))
        }
    }
}

// MARK: - Marks

/// One ring of a ring stack. Rounded caps and a faint track behind it, so a ring at 3%
/// still reads as a ring rather than a stray dot.
struct FuelRing: View {
    var progress: Double
    var color: Color
    var thickness: CGFloat
    var trackOpacity: Double = 0.18

    var body: some View {
        ZStack {
            Circle().stroke(color.opacity(trackOpacity), style: StrokeStyle(lineWidth: thickness, lineCap: .round))
            Circle()
                .trim(from: 0, to: max(0.001, min(1, progress)))
                .stroke(color, style: StrokeStyle(lineWidth: thickness, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
    }
}

/// One band of a RingStack. Declared outside the generic so a caller can build its
/// bands in a helper without having to name the center view's type.
struct RingBand {
    var progress: Double
    var color: Color
}

/// Concentric rings with a caption in the middle.
struct RingStack<Center: View>: View {
    var bands: [RingBand]
    var thickness: CGFloat = 9
    var spacing: CGFloat = 4
    @ViewBuilder var center: Center

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            ZStack {
                ForEach(Array(bands.enumerated()), id: \.offset) { index, band in
                    let inset = CGFloat(index) * (thickness + spacing)
                    FuelRing(progress: band.progress, color: band.color, thickness: thickness)
                        .frame(width: side - inset * 2, height: side - inset * 2)
                }
                center
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
    }
}

/// A horizontal capsule bar — the widget-sized version of the goal bars on Today.
struct CapsuleBar: View {
    var fraction: Double
    var color: Color
    var height: CGFloat = 7

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(color.opacity(0.18))
                Capsule().fill(color)
                    .frame(width: max(height, geo.size.width * max(0, min(1, fraction))))
            }
        }
        .frame(height: height)
    }
}

/// A labelled bar row: name on the left, value on the right, bar underneath.
struct BarRow: View {
    var label: String
    var value: String
    var fraction: Double
    var color: Color

    var body: some View {
        VStack(spacing: 2) {
            HStack {
                Text(label).font(.system(size: 10)).foregroundStyle(.secondary)
                Spacer()
                Text(value).font(.system(size: 10, weight: .semibold))
            }
            CapsuleBar(fraction: fraction, color: color, height: 6)
        }
    }
}

/// An arc gauge — a ring with a gap at the bottom, for a single headline number.
struct ArcGauge<Center: View>: View {
    var fraction: Double
    var color: Color
    var thickness: CGFloat = 11
    @ViewBuilder var center: Center

    var body: some View {
        ZStack {
            Circle()
                .trim(from: 0, to: 0.75)
                .stroke(color.opacity(0.16), style: StrokeStyle(lineWidth: thickness, lineCap: .round))
                .rotationEffect(.degrees(135))
            Circle()
                .trim(from: 0, to: 0.75 * max(0.001, min(1, fraction)))
                .stroke(color, style: StrokeStyle(lineWidth: thickness, lineCap: .round))
                .rotationEffect(.degrees(135))
            center
        }
    }
}

/// The deficit/surplus strip: one rounded bar per day, up for surplus, down for deficit,
/// sharing a zero line. The same reading as the chart on Today, at a tenth the size.
struct BalanceStrip: View {
    var days: [FuelWidgetDay]
    var palette: FuelWidgetPalette
    var showLabels: Bool = true

    private var scale: Double {
        max(1, days.map { abs($0.balance) }.max() ?? 1)
    }

    var body: some View {
        GeometryReader { geo in
            let half = (geo.size.height - (showLabels ? 12 : 0)) / 2
            VStack(spacing: 2) {
                HStack(alignment: .center, spacing: 5) {
                    ForEach(days, id: \.date) { day in
                        let magnitude = CGFloat(abs(day.balance) / scale) * half
                        let surplus = day.balance > 0
                        VStack(spacing: 0) {
                            ZStack(alignment: .bottom) {
                                Color.clear
                                if surplus {
                                    Capsule().fill(palette.surplusColor).frame(height: max(3, magnitude))
                                }
                            }
                            .frame(height: half)
                            ZStack(alignment: .top) {
                                Color.clear
                                if !surplus {
                                    Capsule().fill(palette.deficitColor).frame(height: max(3, magnitude))
                                }
                            }
                            .frame(height: half)
                        }
                    }
                }
                .overlay(alignment: .center) {
                    Rectangle().fill(.secondary.opacity(0.35)).frame(height: 1)
                }
                if showLabels {
                    HStack(spacing: 5) {
                        ForEach(days, id: \.date) { day in
                            Text(FuelWidgetFormat.weekday(day.date))
                                .font(.system(size: 8))
                                .foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity)
                        }
                    }
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
    }
}

/// A tiny line, for trends that only need a shape.
struct Sparkline: View {
    var values: [Double]
    var color: Color

    var body: some View {
        GeometryReader { geo in
            let lo = values.min() ?? 0
            let hi = values.max() ?? 1
            let span = max(0.0001, hi - lo)
            Path { path in
                for (index, value) in values.enumerated() {
                    let x = values.count == 1 ? geo.size.width / 2
                        : geo.size.width * CGFloat(index) / CGFloat(values.count - 1)
                    let y = geo.size.height * (1 - CGFloat((value - lo) / span))
                    if index == 0 { path.move(to: CGPoint(x: x, y: y)) }
                    else { path.addLine(to: CGPoint(x: x, y: y)) }
                }
            }
            .stroke(color, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
        }
    }
}

/// Shown in place of real numbers when the app has never written a snapshot.
struct NotSyncedYet: View {
    var body: some View {
        Text("Open Fuel to sync")
            .font(.system(size: 9, weight: .medium))
            .foregroundStyle(.secondary)
    }
}
