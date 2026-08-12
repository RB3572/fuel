import SwiftUI
import Charts

// The website's Charts page, rebuilt around the question people actually bring to it:
// "does X move with Y?" Two metrics, each with its own vertical axis — left for the
// first, right for the second — so steps (~10,000) and sleep (~7h) can share one time
// axis without either flattening into a straight line.
//
// SwiftUI Charts has one y-domain per chart, so the second series is rescaled into the
// first's range before plotting and the trailing axis is labelled with the inverse
// transform. That is what a dual-axis chart is under the hood in any library; doing it
// explicitly keeps the mapping honest and in one place.

struct TrendsView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme

    @State private var primaryKey: String = UserDefaults.standard.string(forKey: "fuelTrendPrimary") ?? "caloriesConsumed"
    @State private var secondaryKey: String = UserDefaults.standard.string(forKey: "fuelTrendSecondary") ?? "totalExpenditure"
    @State private var selectedDate: String?

    private var trends: [DaySummary] { store.dashboard?.trends ?? [] }

    /// Reuses Explore's metric catalogue rather than keeping a second, drifting list —
    /// anything plottable there is plottable here.
    private var metrics: [ExploreMetric] { exploreMetrics }
    private func metric(_ key: String) -> ExploreMetric? { metrics.first { $0.key == key } }

    private struct Plotted {
        var def: ExploreMetric
        var points: [(date: String, value: Double)]
        var min: Double
        var max: Double
        var average: Double
    }

    private func plotted(_ key: String) -> Plotted? {
        guard let def = metric(key) else { return nil }
        let points = trends.compactMap { day in def.value(day).map { (date: day.date, value: $0) } }
        guard !points.isEmpty else { return nil }
        let values = points.map(\.value)
        return Plotted(def: def, points: points, min: values.min() ?? 0, max: values.max() ?? 0,
                       average: values.reduce(0, +) / Double(values.count))
    }

    private var primary: Plotted? { plotted(primaryKey) }
    private var secondary: Plotted? { secondaryKey.isEmpty ? nil : plotted(secondaryKey) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    Panel {
                        pickers
                        chartBody
                    }
                    averagesPanel
                    CompareCards()
                }
                .padding(16)
            }
            .background(Palette.background(scheme))
            .navigationTitle("Trends")
            .refreshable { await store.load() }
        }
    }

    private var pickers: some View {
        VStack(spacing: 8) {
            metricPicker(title: "Left axis", selection: $primaryKey, colour: DashboardTheme.shared.accent,
                         storageKey: "fuelTrendPrimary", allowNone: false)
            metricPicker(title: "Right axis", selection: $secondaryKey, colour: DashboardTheme.shared.secondary,
                         storageKey: "fuelTrendSecondary", allowNone: true)
        }
    }

    private func metricPicker(title: String, selection: Binding<String>, colour: Color,
                              storageKey: String, allowNone: Bool) -> some View {
        HStack(spacing: 8) {
            Capsule().fill(colour).frame(width: 12, height: 4)
            Text(title).font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
            Spacer()
            Picker(title, selection: selection) {
                if allowNone { Text("None").tag("") }
                ForEach(exploreGroups, id: \.self) { group in
                    Section(group) {
                        ForEach(metrics.filter { $0.group == group }, id: \.key) { m in
                            Text(m.label).tag(m.key)
                        }
                    }
                }
            }
            .pickerStyle(.menu)
            .onChange(of: selection.wrappedValue) { _, value in
                UserDefaults.standard.set(value, forKey: storageKey)
            }
        }
    }

    @ViewBuilder
    private var chartBody: some View {
        if let primary {
            ZoomableDateChart(dates: primary.points.map(\.date),
                              trailingAxis: secondary.map { second in
                                  .init(label: second.def.label,
                                        decimals: second.def.decimals,
                                        toPrimary: { rescale($0, from: second, to: primary) },
                                        fromPrimary: { rescale($0, from: primary, to: second) })
                              }) {
                ForEach(primary.points, id: \.date) { point in
                    LineMark(x: .value("Date", point.date),
                             y: .value(primary.def.label, point.value),
                             series: .value("Series", primary.def.label))
                        .foregroundStyle(DashboardTheme.shared.accent)
                        .interpolationMethod(.monotone)
                }
                if let secondary {
                    ForEach(secondary.points, id: \.date) { point in
                        LineMark(x: .value("Date", point.date),
                                 y: .value(primary.def.label, rescale(point.value, from: secondary, to: primary)),
                                 series: .value("Series", secondary.def.label))
                            .foregroundStyle(DashboardTheme.shared.secondary)
                            .interpolationMethod(.monotone)
                    }
                }
            }
        } else {
            Text("No data for that metric in the last 30 days.")
                .font(.footnote).foregroundStyle(Palette.muted(scheme))
                .frame(maxWidth: .infinity, minHeight: 200)
        }
    }

    /// Maps a value from one series' range onto another's, so both fit one y-domain.
    /// A flat series (min == max) maps to the middle rather than dividing by zero.
    private func rescale(_ value: Double, from source: Plotted, to target: Plotted) -> Double {
        let sourceSpan = source.max - source.min
        let targetSpan = target.max - target.min
        guard sourceSpan > 0 else { return target.min + targetSpan / 2 }
        return target.min + (value - source.min) / sourceSpan * targetSpan
    }

    /// The averages for whatever is currently plotted — the old panel always showed the
    /// same three energy figures regardless of what the chart was displaying.
    private var averagesPanel: some View {
        Panel(title: "Averages · last \(trends.count) days") {
            HStack(alignment: .top, spacing: 12) {
                if let primary {
                    Stat(label: primary.def.label,
                         value: "\(Format.number(primary.average, decimals: primary.def.decimals)) \(primary.def.unit)",
                         tint: DashboardTheme.shared.accent)
                }
                if let secondary {
                    Stat(label: secondary.def.label,
                         value: "\(Format.number(secondary.average, decimals: secondary.def.decimals)) \(secondary.def.unit)",
                         tint: DashboardTheme.shared.secondary)
                }
            }
        }
    }
}

/// A line chart over a categorical date axis that scrolls and pinch-zooms, with the
/// window defaulting to the most recent stretch rather than the whole range. Shared by
/// Trends and Explore so the gesture and scroll plumbing exists once.
struct ZoomableDateChart<Content: ChartContent>: View {
    /// Describes a second y-axis drawn on the trailing edge, labelled in the secondary
    /// series' own units even though the marks were rescaled into the primary's domain.
    struct TrailingAxis {
        var label: String
        var decimals: Int
        var toPrimary: (Double) -> Double
        var fromPrimary: (Double) -> Double
    }

    @Environment(\.colorScheme) private var scheme
    let dates: [String]
    var height: CGFloat = 240
    /// Explore's "Relative" mode pre-scales every series to 0–100, so its axis reads as
    /// percentages rather than raw values.
    var percentAxis: Bool = false
    var trailingAxis: TrailingAxis?
    @ChartContentBuilder var content: () -> Content

    @State private var visibleCount: Double
    @GestureState private var magnifyBy: CGFloat = 1

    private static var defaultWindow: Int { 10 }

    init(dates: [String], height: CGFloat = 240, percentAxis: Bool = false,
         trailingAxis: TrailingAxis? = nil,
         @ChartContentBuilder content: @escaping () -> Content) {
        self.dates = dates
        self.height = height
        self.percentAxis = percentAxis
        self.trailingAxis = trailingAxis
        self.content = content
        _visibleCount = State(initialValue: Double(min(Self.defaultWindow, max(dates.count, 1))))
    }

    /// Anchors the leading edge so the window *ends* on the most recent day.
    private var initialScrollDate: String {
        let start = max(0, dates.count - Self.defaultWindow)
        return dates.indices.contains(start) ? dates[start] : (dates.last ?? "")
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            Chart(content: content)
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 4)) { value in
                        AxisGridLine()
                        AxisTick()
                        AxisValueLabel {
                            if let iso = value.as(String.self) {
                                Text(DateAxis.short(iso)).font(.system(size: 10))
                            }
                        }
                    }
                }
                .chartYAxis {
                    if percentAxis {
                        AxisMarks(values: [0, 25, 50, 75, 100]) { value in
                            AxisGridLine()
                            AxisValueLabel { if let v = value.as(Double.self) { Text("\(Int(v))%") } }
                        }
                    } else {
                        AxisMarks(position: .leading, values: .automatic(desiredCount: 4))
                    }
                    if let trailingAxis {
                        AxisMarks(position: .trailing, values: .automatic(desiredCount: 4)) { value in
                            AxisValueLabel {
                                if let v = value.as(Double.self) {
                                    Text(Format.number(trailingAxis.fromPrimary(v), decimals: trailingAxis.decimals))
                                        .font(.system(size: 10))
                                }
                            }
                        }
                    }
                }
                .chartLegend(.hidden)
                // An explicit domain in date order. Without it each series contributes
                // its own categories in its own order, so two metrics with different
                // gaps produced a different x-ordering each and the lines crossed back
                // over themselves.
                .chartXScale(domain: dates)
                .chartScrollableAxes(.horizontal)
                .chartXVisibleDomain(length: max(3, Int((visibleCount / magnifyBy).rounded())))
                .chartScrollPosition(initialX: initialScrollDate)
                .simultaneousGesture(
                    MagnificationGesture()
                        .updating($magnifyBy) { value, state, _ in state = value }
                        .onEnded { value in
                            visibleCount = min(Double(max(dates.count, 1)), max(3, visibleCount / value))
                        }
                )
                .frame(height: height)
            if dates.count > Self.defaultWindow {
                Text("Scroll · pinch to zoom")
                    .font(.system(size: 10)).foregroundStyle(Palette.muted(scheme))
            }
        }
    }
}

/// Shared date formatting for every chart's time axis. An ISO string on a tick mark is
/// unreadable at a glance, and the weekday is usually the point ("what happened
/// Saturday?").
enum DateAxis {
    static func short(_ iso: String) -> String { format(iso, shortFormatter) }
    static func long(_ iso: String) -> String { format(iso, longFormatter) }

    private static func format(_ iso: String, _ formatter: DateFormatter) -> String {
        guard let date = isoFormatter.date(from: iso) else { return iso }
        return formatter.string(from: date)
    }

    private static let isoFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = .current
        return f
    }()
    private static let shortFormatter: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEE MMM d")
        return f
    }()
    private static let longFormatter: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEEE MMM d")
        return f
    }()
}
