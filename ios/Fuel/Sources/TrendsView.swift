import SwiftUI
import Charts

// The website's Charts page. Same metrics, but one chart at a time with a picker
// instead of a wall of them — a 6-inch screen cannot usefully show fifteen charts, and
// scrolling past fourteen to reach the one you wanted is worse than choosing.
//
// Energy and Macros are multi-series: one labelled line per component rather than a
// single line standing in for the whole group. "Macros" as one line is the shape of a
// question nobody asks — protein, carbs and fat move independently and the interesting
// read is how they move relative to each other, which a single line cannot show.
//
// Every chart scrolls and pinch-zooms on the date axis, matching the deficit/surplus
// chart on Today: 30 days of daily points is unreadable at phone width, so the default
// window is short and widening it is a gesture rather than a mode.

struct TrendsView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme
    @State private var metric: Metric = .energy

    enum Metric: String, CaseIterable, Identifiable {
        case energy = "Energy"
        case macros = "Macros"
        case steps = "Steps"
        case sleep = "Sleep"
        case restingHR = "Resting HR"
        case hrv = "HRV"
        case vo2 = "VO₂ max"
        var id: String { rawValue }

        var unit: String {
            switch self {
            case .energy: return "kcal"
            case .macros: return "g"
            case .steps: return "steps"
            case .sleep: return "h"
            case .restingHR, .hrv: return self == .hrv ? "ms" : "bpm"
            case .vo2: return "mL/kg/min"
            }
        }
    }

    /// One named, coloured line. Energy and Macros build several; every other metric
    /// builds exactly one, so the chart body below has a single shape to render.
    private struct Line: Identifiable {
        var id: String { name }
        var name: String
        var color: Color
        var points: [(date: String, value: Double)]
    }

    private var trends: [DaySummary] { store.dashboard?.trends ?? [] }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    Panel {
                        Picker("Metric", selection: $metric) {
                            ForEach(Metric.allCases) { Text($0.rawValue).tag($0) }
                        }
                        .pickerStyle(.menu)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        chartBody
                    }
                    averagesPanel
                }
                .padding(16)
            }
            .background(Palette.background(scheme))
            .navigationTitle("Trends")
            .refreshable { await store.load() }
        }
    }

    @ViewBuilder
    private var chartBody: some View {
        let lines = self.lines(for: metric)
        let plotted = lines.filter { !$0.points.isEmpty }
        if plotted.isEmpty {
            Text("No data in the last 30 days.")
                .font(.footnote).foregroundStyle(Palette.muted(scheme))
                .frame(maxWidth: .infinity, minHeight: 200)
        } else {
            // Only worth a legend when there's more than one thing to tell apart.
            if plotted.count > 1 {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 8)], alignment: .leading, spacing: 6) {
                    ForEach(plotted) { line in
                        HStack(spacing: 5) {
                            Capsule().fill(line.color).frame(width: 14, height: 5)
                            Text(line.name).font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                                .lineLimit(1)
                        }
                    }
                }
            }
            ZoomableDateChart(dates: dates, unit: metric.unit) {
                ForEach(plotted) { line in
                    ForEach(line.points, id: \.date) { point in
                        LineMark(x: .value("Date", point.date),
                                 y: .value(metric.unit, point.value),
                                 series: .value("Series", line.name))
                            .foregroundStyle(line.color)
                            .interpolationMethod(.monotone)
                    }
                }
            }
        }
    }

    private var dates: [String] { trends.map(\.date) }

    private func lines(for metric: Metric) -> [Line] {
        let theme = DashboardTheme.shared
        func series(_ name: String, _ color: Color, _ value: @escaping (DaySummary) -> Double?) -> Line {
            Line(name: name, color: color,
                 points: trends.compactMap { day in value(day).map { (date: day.date, value: $0) } })
        }
        switch metric {
        case .energy:
            // Four independent readings, not one: "burned" is resting + active, and
            // seeing intake against all three is the whole point of the chart.
            return [
                series("Burned", Palette.muted(scheme)) { $0.totalExpenditure },
                series("Consumed", Palette.ink(scheme)) { $0.caloriesConsumed },
                series("Active", theme.secondary) { $0.activeEnergy },
                series("Resting", theme.tertiary) { $0.restingEnergy },
            ]
        case .macros:
            return [
                series("Protein", theme.secondary) { $0.protein },
                series("Carbs", theme.accent) { $0.carbs },
                series("Fat", theme.tertiary) { $0.fat },
                series("Fiber", Palette.muted(scheme)) { $0.fiber },
            ]
        case .steps: return [series("Steps", theme.accent) { $0.stepCount }]
        case .sleep: return [series("Sleep", theme.accent) { $0.sleepHours }]
        case .restingHR: return [series("Resting HR", theme.accent) { $0.restingHeartRate }]
        case .hrv: return [series("HRV", theme.accent) { $0.hrv }]
        case .vo2: return [series("VO₂ max", theme.accent) { $0.vo2Max }]
        }
    }

    private var averagesPanel: some View {
        Panel(title: "Averages") {
            HStack(alignment: .top, spacing: 8) {
                Stat(label: "Burned", value: Format.kcal(store.dashboard?.energyAverages?.totalExpenditure))
                Stat(label: "Resting", value: Format.kcal(store.dashboard?.energyAverages?.restingEnergy))
                Stat(label: "Active", value: Format.kcal(store.dashboard?.energyAverages?.activeEnergy))
            }
        }
    }
}

/// A line chart over a categorical date axis that scrolls and pinch-zooms, with the
/// window defaulting to the most recent stretch rather than the whole range. Factored
/// out because Trends and Explore both need exactly this and the gesture/scroll
/// plumbing is fiddly enough that two copies would drift.
struct ZoomableDateChart<Content: ChartContent>: View {
    @Environment(\.colorScheme) private var scheme
    let dates: [String]
    var unit: String = ""
    var height: CGFloat = 240
    /// Explore's "Relative" mode pre-scales every series to 0–100, so its axis reads as
    /// percentages rather than raw values.
    var percentAxis: Bool = false
    @ChartContentBuilder var content: () -> Content

    /// How many days are visible at once. Starts at a readable window rather than the
    /// full range: 30 daily points across a phone is a smear.
    @State private var visibleCount: Double
    @GestureState private var magnifyBy: CGFloat = 1
    @State private var scrollPosition: String = ""

    private static var defaultWindow: Int { 10 }

    init(dates: [String], unit: String = "", height: CGFloat = 240, percentAxis: Bool = false,
         @ChartContentBuilder content: @escaping () -> Content) {
        self.dates = dates
        self.unit = unit
        self.height = height
        self.percentAxis = percentAxis
        self.content = content
        _visibleCount = State(initialValue: Double(min(Self.defaultWindow, max(dates.count, 1))))
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            Chart(content: content)
                .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) }
                .chartYAxis {
                    if percentAxis {
                        AxisMarks(values: [0, 25, 50, 75, 100]) { value in
                            AxisGridLine()
                            AxisValueLabel { if let v = value.as(Double.self) { Text("\(Int(v))%") } }
                        }
                    } else {
                        AxisMarks(values: .automatic(desiredCount: 4))
                    }
                }
                .chartLegend(.hidden)
                .chartScrollableAxes(.horizontal)
                .chartXVisibleDomain(length: max(3, Int((visibleCount / magnifyBy).rounded())))
                .chartScrollPosition(x: $scrollPosition)
                .simultaneousGesture(
                    MagnificationGesture()
                        .updating($magnifyBy) { value, state, _ in state = value }
                        .onEnded { value in
                            visibleCount = min(Double(max(dates.count, 1)), max(3, visibleCount / value))
                        }
                )
                .onAppear { scrollPosition = dates.last ?? "" }
                .frame(height: height)
            if dates.count > Self.defaultWindow {
                Text("Scroll · pinch to zoom")
                    .font(.system(size: 10)).foregroundStyle(Palette.muted(scheme))
            }
        }
    }
}
