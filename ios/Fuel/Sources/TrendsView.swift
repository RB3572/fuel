import SwiftUI
import Charts

// The website's Charts page. Same metrics, but one chart at a time with a picker
// instead of a wall of them — a 6-inch screen cannot usefully show fifteen charts, and
// scrolling past fourteen to reach the one you wanted is worse than choosing.

struct TrendsView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme
    @State private var metric: Metric = .energy

    enum Metric: String, CaseIterable, Identifiable {
        case energy = "Energy"
        case weightlessMacros = "Macros"
        case steps = "Steps"
        case sleep = "Sleep"
        case restingHR = "Resting HR"
        case hrv = "HRV"
        case vo2 = "VO₂ max"
        var id: String { rawValue }
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
                        chart
                            .frame(height: 240)
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
    private var chart: some View {
        let series = points(for: metric)
        if series.isEmpty {
            Text("No data in the last 30 days.")
                .font(.footnote).foregroundStyle(Palette.muted(scheme))
                .frame(maxWidth: .infinity, minHeight: 200)
        } else if metric == .energy {
            Chart {
                ForEach(trends, id: \.date) { day in
                    if let consumed = day.caloriesConsumed {
                        BarMark(x: .value("Date", day.date), y: .value("kcal", consumed))
                            .foregroundStyle(Palette.flameMid)
                            .position(by: .value("Series", "Consumed"))
                    }
                    if let burned = day.totalExpenditure {
                        BarMark(x: .value("Date", day.date), y: .value("kcal", burned))
                            .foregroundStyle(Palette.muted(scheme))
                            .position(by: .value("Series", "Burned"))
                    }
                }
            }
            .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) }
        } else if metric == .weightlessMacros {
            Chart {
                ForEach(trends, id: \.date) { day in
                    if let protein = day.protein {
                        LineMark(x: .value("Date", day.date), y: .value("g", protein))
                            .foregroundStyle(Palette.flameMid)
                    }
                    if let carbs = day.carbs {
                        LineMark(x: .value("Date", day.date), y: .value("g", carbs))
                            .foregroundStyle(Palette.accentSoft)
                    }
                    if let fat = day.fat {
                        LineMark(x: .value("Date", day.date), y: .value("g", fat))
                            .foregroundStyle(Palette.muted(scheme))
                    }
                }
            }
            .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) }
        } else {
            Chart(series, id: \.0) { point in
                LineMark(x: .value("Date", point.0), y: .value(metric.rawValue, point.1))
                    .foregroundStyle(Palette.ink(scheme))
                    .interpolationMethod(.monotone)
                AreaMark(x: .value("Date", point.0), y: .value(metric.rawValue, point.1))
                    .foregroundStyle(.linearGradient(colors: [Palette.flameMid.opacity(0.22), .clear],
                                                     startPoint: .top, endPoint: .bottom))
            }
            .chartXAxis { AxisMarks(values: .automatic(desiredCount: 4)) }
        }
    }

    private func points(for metric: Metric) -> [(String, Double)] {
        trends.compactMap { day in
            let value: Double?
            switch metric {
            case .energy: value = day.caloriesConsumed
            case .weightlessMacros: value = day.protein
            case .steps: value = day.stepCount
            case .sleep: value = day.sleepHours
            case .restingHR: value = day.restingHeartRate
            case .hrv: value = day.hrv
            case .vo2: value = day.vo2Max
            }
            guard let value else { return nil }
            return (day.date, value)
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
