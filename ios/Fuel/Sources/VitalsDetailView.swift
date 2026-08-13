import SwiftUI
import Charts

// The long form of the banner on Today. The banner has room for one line per vital and
// a z-score; this shows each vital against its own history, which is the thing the
// z-score is a summary of. Seeing 44 sitting on a flat 44 baseline is what makes "Low ↓"
// obviously wrong — a number alone never would.

struct VitalsDetailView: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss
    let trends: [DaySummary]
    let summary: DaySummary?

    private var signal: VitalsSignalResult { computeVitalsSignal(trends: trends, summary: summary) }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                scorePanel(signal)
                ForEach(signal.items, id: \.key) { item in
                    VitalTrendPanel(item: item, trends: trends, today: summary?.date)
                }
                Text("Each chart is your own history for that vital. The band is your usual range — the median plus or minus the spread the score is measured against. A day outside the band is unusual for you; a day inside it is not, however far from the median it looks. Informational only — not a medical diagnosis.")
                    .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
            }
            .padding(16)
        }
        .background(Palette.background(scheme))
        .navigationTitle("Vitals")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func scorePanel(_ s: VitalsSignalResult) -> some View {
        Panel {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 1) {
                    Text("\(s.score ?? 0)").font(.system(size: 34, weight: .bold))
                    Text("/10").font(.system(size: 14)).opacity(0.6)
                }
                .foregroundStyle(tone(s.status))
                VStack(alignment: .leading, spacing: 2) {
                    Text(s.status == .flag ? "Unusual for you today"
                         : s.status == .watch ? "One vital is drifting"
                         : "In line with your baseline")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Palette.ink(scheme))
                    Text("\(s.evaluated) vital\(s.evaluated == 1 ? "" : "s") compared against your history")
                        .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                }
                Spacer()
            }
        }
    }

    private func tone(_ status: VitalsStatus) -> Color {
        switch status { case .flag: return .red; case .watch: return .orange; default: return .green }
    }
}

/// One vital: today's number, its baseline, and the history the comparison is made
/// against, with the usual-range band drawn behind the line.
///
/// The x axis is real `Date`s, not date strings. Strings gave Charts a categorical axis,
/// which labelled every single day — thirty labels overlapping into an unreadable smear —
/// placed points by their order in the array rather than by when they happened, and
/// rendered the range band over one category instead of spanning the plot. Dates fix all
/// three at once, and let the tick density follow the zoom.
struct VitalTrendPanel: View {
    @Environment(\.colorScheme) private var scheme
    let item: VitalItem
    let trends: [DaySummary]
    let today: String?

    /// Days shown at once. Pinch changes it; the axis thins its labels to match.
    @State private var visibleDays: Double = 30
    @GestureState private var magnifyBy: CGFloat = 1

    private var theme: DashboardTheme { DashboardTheme.shared }

    /// Sorted, de-duplicated and parsed. Sorting is not decoration: a line chart connects
    /// points in array order, so a single out-of-order or repeated day draws a stray
    /// segment doubling back across the whole plot.
    private var points: [(date: Date, value: Double)] {
        var byDay: [Date: Double] = [:]
        for day in trends {
            guard let value = item.key.value(day), let date = VitalAxis.parse(day.date) else { continue }
            byDay[date] = value
        }
        return byDay.sorted { $0.key < $1.key }.map { (date: $0.key, value: $0.value) }
    }

    private var todayDate: Date? { today.flatMap(VitalAxis.parse) }

    /// The band the score actually uses: median ± the same sigma the z-score divides by,
    /// floored at the vital's minimum meaningful spread. Drawing it makes the floor
    /// visible instead of implicit.
    private var band: (low: Double, high: Double)? {
        guard let center = item.center, let z = item.z, z != 0 else {
            return item.center.map { ($0 - item.key.minimumMeaningfulSpread, $0 + item.key.minimumMeaningfulSpread) }
        }
        let sigma = abs((item.today - center) / z)
        return (center - 2 * sigma, center + 2 * sigma)
    }

    private var window: Double {
        let span = Double(points.count)
        return min(max(4, visibleDays / Double(magnifyBy)), max(4, span))
    }

    /// The trailing `window` days, always ending one day past the last reading so that
    /// day's own mark falls inside the domain rather than sitting on its edge. No
    /// drag-to-scroll: `chartScrollableAxes` sat inside this panel's outer vertical
    /// ScrollView, and a diagonal drag could trigger both at once, which read as the
    /// whole page being freely draggable rather than as a chart with its own scroll.
    /// Pinch alone can't cause that ambiguity, so it is the only way to change what's
    /// visible.
    private var visibleRange: ClosedRange<Date> {
        guard let last = points.last?.date else {
            let now = Date()
            return now...now
        }
        let calendar = Calendar.current
        let start = calendar.date(byAdding: .day, value: -Int(window) + 1, to: last) ?? last
        let end = calendar.date(byAdding: .day, value: 1, to: last) ?? last
        return start...end
    }

    var body: some View {
        Panel(title: item.key.label) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(Format.number(item.today, decimals: item.key.decimals))
                    .font(.system(size: 24, weight: .bold)).foregroundStyle(Palette.ink(scheme))
                Text(item.key.unit).font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                Spacer()
                if item.insufficient {
                    Text("Not enough history yet").font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                } else {
                    VStack(alignment: .trailing, spacing: 1) {
                        Text("usually ~\(Format.number(item.center, decimals: item.key.decimals))")
                            .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                        Text(item.flagged || item.watch
                             ? "\(item.direction == "up" ? "High ↑" : "Low ↓") · z \(Format.number(item.z.map(abs), decimals: 1))"
                             : "Typical · z \(Format.number(item.z.map(abs), decimals: 1))")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(item.flagged ? .red : item.watch ? .orange : Palette.muted(scheme))
                    }
                }
            }

            if points.count > 1 {
                chart
                Text("Pinch to zoom out for more history")
                    .font(.system(size: 10)).foregroundStyle(Palette.muted(scheme))
            }
        }
    }

    private var chart: some View {
        let series = points
        let ticks = VitalAxis.ticks(forVisibleDays: window)
        return Chart {
            if let band, let first = series.first?.date, let last = series.last?.date {
                // One day past the last point: a day-unit x value marks the *start* of
                // its day, so ending at `last` would stop the band short of the final
                // reading rather than covering it.
                let end = Calendar.current.date(byAdding: .day, value: 1, to: last) ?? last
                RectangleMark(
                    xStart: .value("From", first), xEnd: .value("To", end),
                    yStart: .value("Low", band.low), yEnd: .value("High", band.high)
                )
                .foregroundStyle(theme.accent.opacity(0.10))
            }
            if let center = item.center {
                RuleMark(y: .value("Usual", center))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    .foregroundStyle(Palette.muted(scheme).opacity(0.6))
            }
            ForEach(series, id: \.date) { point in
                // Straight segments, deliberately: a smoothed curve would invent readings
                // between days that were never measured.
                LineMark(x: .value("Day", point.date, unit: .day),
                         y: .value(item.key.label, point.value))
                    .foregroundStyle(theme.accent)
                if point.date == todayDate {
                    PointMark(x: .value("Day", point.date, unit: .day),
                              y: .value(item.key.label, point.value))
                        .foregroundStyle(item.flagged ? .red : item.watch ? .orange : theme.accent)
                        .symbolSize(70)
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: .stride(by: ticks.unit, count: ticks.count)) { value in
                AxisGridLine().foregroundStyle(Palette.muted(scheme).opacity(0.12))
                AxisValueLabel {
                    if let date = value.as(Date.self) {
                        Text(VitalAxis.label(date, ticks.unit)).font(.system(size: 9))
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(values: .automatic(desiredCount: 4)) { value in
                AxisGridLine().foregroundStyle(Palette.muted(scheme).opacity(0.15))
                AxisValueLabel {
                    if let v = value.as(Double.self) {
                        Text(Format.number(v, decimals: item.key.decimals)).font(.system(size: 9))
                    }
                }
            }
        }
        .chartXScale(domain: visibleRange)
        .frame(height: 150)
        .gesture(
            MagnifyGesture()
                .updating($magnifyBy) { value, state, _ in state = value.magnification }
                .onEnded { value in
                    visibleDays = min(max(4, visibleDays / value.magnification), max(4, Double(series.count)))
                }
        )
    }
}

/// Date parsing and tick spacing for the vitals charts.
enum VitalAxis {
    static func parse(_ iso: String) -> Date? { formatter.date(from: iso) }

    /// How often to draw a labelled tick, given how many days are on screen. Zoomed out
    /// to a month you get one a week; zoomed in to a few days you get one a day. The
    /// alternative — a label per day at every zoom — is what made the axis unreadable.
    static func ticks(forVisibleDays days: Double) -> (unit: Calendar.Component, count: Int) {
        switch days {
        case ..<8: return (.day, 1)
        case ..<15: return (.day, 2)
        case ..<32: return (.weekOfYear, 1)
        case ..<70: return (.weekOfYear, 2)
        case ..<200: return (.month, 1)
        default: return (.month, 3)
        }
    }

    static func label(_ date: Date, _ unit: Calendar.Component) -> String {
        let out = DateFormatter()
        out.dateFormat = unit == .month ? "MMM" : "MMM d"
        return out.string(from: date)
    }

    private static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = .current
        f.locale = Locale(identifier: "en_US_POSIX")
        return f
    }()
}
