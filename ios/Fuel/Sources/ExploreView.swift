import SwiftUI
import Charts

// The website's Explore tab (src/ChartsPage.tsx + src/chartMetrics.ts): plot any
// combination of captured daily metrics on one time axis. "Relative" scales each
// series to its own range in the window so differently-sized metrics (steps ~10,000
// vs. sleep ~7h) can be compared by shape; "Actual" puts everything on one shared
// axis. Native SwiftUI Charts auto-fits a shared scale for free in Actual mode, so
// only Relative mode needs the values pre-normalized before charting.
//
// One metric is dropped versus the website: workoutCount has no field on a trend
// point (DaySummary) — only "today" carries a workouts array — so there's nothing to
// plot for past days.

struct ExploreMetric {
    var key: String
    var label: String
    var unit: String
    var decimals: Int
    var group: String
    var value: (DaySummary) -> Double?
}

let exploreGroups = ["Energy", "Nutrition", "Activity", "Vitals & recovery"]

let exploreMetrics: [ExploreMetric] = [
    .init(key: "energyBalance", label: "Surplus / deficit", unit: "kcal", decimals: 0, group: "Energy", value: { $0.energyBalance }),
    .init(key: "caloriesConsumed", label: "Calories eaten", unit: "kcal", decimals: 0, group: "Energy", value: { $0.caloriesConsumed }),
    .init(key: "totalExpenditure", label: "Total burned", unit: "kcal", decimals: 0, group: "Energy", value: { $0.totalExpenditure }),
    .init(key: "activeEnergy", label: "Active energy", unit: "kcal", decimals: 0, group: "Energy", value: { $0.activeEnergy }),
    .init(key: "restingEnergy", label: "Resting energy", unit: "kcal", decimals: 0, group: "Energy", value: { $0.restingEnergy }),
    .init(key: "protein", label: "Protein", unit: "g", decimals: 0, group: "Nutrition", value: { $0.protein }),
    .init(key: "carbs", label: "Carbohydrates", unit: "g", decimals: 0, group: "Nutrition", value: { $0.carbs }),
    .init(key: "fat", label: "Fat", unit: "g", decimals: 0, group: "Nutrition", value: { $0.fat }),
    .init(key: "fiber", label: "Fiber", unit: "g", decimals: 0, group: "Nutrition", value: { $0.fiber }),
    .init(key: "sugars", label: "Sugars", unit: "g", decimals: 0, group: "Nutrition", value: { $0.sugars }),
    .init(key: "addedSugars", label: "Added sugars", unit: "g", decimals: 0, group: "Nutrition", value: { $0.addedSugars }),
    .init(key: "sodium", label: "Sodium", unit: "mg", decimals: 0, group: "Nutrition", value: { $0.sodium }),
    .init(key: "caffeine", label: "Caffeine", unit: "mg", decimals: 0, group: "Nutrition", value: { $0.caffeine }),
    .init(key: "stepCount", label: "Steps", unit: "steps", decimals: 0, group: "Activity", value: { $0.stepCount }),
    .init(key: "exerciseMinutes", label: "Exercise minutes", unit: "min", decimals: 0, group: "Activity", value: { $0.exerciseMinutes }),
    .init(key: "standMinutes", label: "Stand minutes", unit: "min", decimals: 0, group: "Activity", value: { $0.standMinutes }),
    .init(key: "flightsClimbed", label: "Flights climbed", unit: "flights", decimals: 0, group: "Activity", value: { $0.flightsClimbed }),
    .init(key: "distanceMiles", label: "Walk + run distance", unit: "mi", decimals: 2, group: "Activity", value: { $0.distanceMiles }),
    .init(key: "cyclingDistanceMiles", label: "Cycling distance", unit: "mi", decimals: 2, group: "Activity", value: { $0.cyclingDistanceMiles }),
    .init(key: "swimmingDistanceYards", label: "Swimming distance", unit: "yd", decimals: 0, group: "Activity", value: { $0.swimmingDistanceYards }),
    .init(key: "runningStrideLength", label: "Running stride length", unit: "m", decimals: 2, group: "Activity", value: { $0.runningStrideLength }),
    .init(key: "restingHeartRate", label: "Resting heart rate", unit: "bpm", decimals: 0, group: "Vitals & recovery", value: { $0.restingHeartRate }),
    .init(key: "hrv", label: "HRV (SDNN)", unit: "ms", decimals: 0, group: "Vitals & recovery", value: { $0.hrv }),
    .init(key: "walkingHeartRateAverage", label: "Walking heart rate", unit: "bpm", decimals: 0, group: "Vitals & recovery", value: { $0.walkingHeartRateAverage }),
    .init(key: "respiratoryRate", label: "Respiratory rate", unit: "/min", decimals: 1, group: "Vitals & recovery", value: { $0.respiratoryRate }),
    .init(key: "bloodOxygen", label: "Blood oxygen", unit: "%", decimals: 1, group: "Vitals & recovery", value: { $0.bloodOxygen }),
    .init(key: "cardioRecovery", label: "Cardio recovery", unit: "bpm", decimals: 0, group: "Vitals & recovery", value: { $0.cardioRecovery }),
    .init(key: "vo2Max", label: "VO₂ max", unit: "mL/kg/min", decimals: 1, group: "Vitals & recovery", value: { $0.vo2Max }),
    .init(key: "sleepHours", label: "Sleep", unit: "h", decimals: 1, group: "Vitals & recovery", value: { $0.sleepHours }),
]

let exploreSeriesColors: [Color] = [
    Color(hex: 0x111111), Color(hex: 0xE5734F), Color(hex: 0x2F8F6B), Color(hex: 0x3F76B5),
    Color(hex: 0xB7791F), Color(hex: 0x8B5CF6), Color(hex: 0xD92D20), Color(hex: 0x0E8EA3),
]
let exploreMaxSeries = exploreSeriesColors.count

struct ExploreView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme
    @State private var selected: [String]
    @State private var days = 30
    @State private var mode: Mode = .normalized
    @State private var pickerOpen = false

    enum Mode { case normalized, actual }

    init() {
        let validKeys = Set(exploreMetrics.map(\.key))
        let saved = (UserDefaults.standard.array(forKey: "fuelChartSeries") as? [String])?.filter { validKeys.contains($0) }
        let initial = (saved?.isEmpty == false ? saved! : ["energyBalance", "stepCount"])
        _selected = State(initialValue: Array(initial.prefix(exploreMaxSeries)))
    }

    private var trends: [DaySummary] { store.dashboard?.trends ?? [] }
    private var windowed: [DaySummary] { days >= trends.count ? trends : Array(trends.suffix(days)) }

    private struct Series {
        var key: String; var label: String; var unit: String; var decimals: Int
        var color: Color
        var values: [Double?]
        var min: Double; var max: Double; var avg: Double
    }

    private var series: [Series] {
        selected.enumerated().compactMap { index, key in
            guard let def = exploreMetrics.first(where: { $0.key == key }) else { return nil }
            let values = windowed.map { def.value($0) }
            let present = values.compactMap { $0 }
            return Series(key: key, label: def.label, unit: def.unit, decimals: def.decimals,
                         color: exploreSeriesColors[index % exploreSeriesColors.count], values: values,
                         min: present.min() ?? 0, max: present.max() ?? 0,
                         avg: present.isEmpty ? 0 : present.reduce(0, +) / Double(present.count))
        }
    }

    private var withData: [Series] { series.filter { $0.values.contains { $0 != nil } } }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                controls
                Panel {
                    if withData.isEmpty {
                        Text(selected.isEmpty ? "Pick one or more metrics below to start plotting." : "No data for the selected metrics in this window.")
                            .font(.footnote).foregroundStyle(Palette.muted(scheme))
                            .frame(maxWidth: .infinity, minHeight: 160)
                    } else {
                        chart.frame(height: 240)
                        if mode == .actual, Set(withData.map(\.unit)).count > 1, withData.count > 1 {
                            Text("These metrics use different units but share one axis. Switch to Relative to compare their shapes fairly.")
                                .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme)).padding(.top, 4)
                        } else {
                            Text("Each line is scaled to its own range over this window, so shapes can be compared directly. Tap a legend row to remove it.")
                                .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme)).padding(.top, 4)
                        }
                    }
                }
                if !withData.isEmpty { legend }
                picker
            }
            .padding(16)
        }
        .background(Palette.background(scheme))
        .navigationTitle("Explore")
    }

    private var controls: some View {
        Panel {
            Text("Plot anything over time").font(.system(size: 18, weight: .bold, design: .rounded)).foregroundStyle(Palette.ink(scheme))
            Text("Overlay any metrics Fuel captures on one time axis.").font(.system(size: 13)).foregroundStyle(Palette.muted(scheme))
            Picker("Range", selection: $days) {
                Text("7d").tag(7)
                Text("14d").tag(14)
                Text("30d").tag(30)
                Text("90d").tag(90)
                Text("All").tag(3650)
            }
            .pickerStyle(.segmented)
            Picker("Scale", selection: $mode) {
                Text("Relative").tag(Mode.normalized)
                Text("Actual").tag(Mode.actual)
            }
            .pickerStyle(.segmented)
        }
    }

    private var chart: some View {
        // Keyed by the window so changing the range or metric set rebuilds the chart
        // with a fresh zoom window instead of keeping a stale one that may no longer
        // contain any of the new dates.
        ZoomableDateChart(dates: windowed.map(\.date), height: 240, percentAxis: mode == .normalized) {
            ForEach(withData, id: \.key) { s in
                ForEach(points(for: s), id: \.date) { point in
                    LineMark(x: .value("Date", point.date), y: .value("Value", point.value), series: .value("Metric", s.key))
                        .foregroundStyle(s.color)
                        .interpolationMethod(.monotone)
                }
            }
        }
        .id("\(days)-\(selected.joined(separator: ","))")
    }

    private func plotValue(_ s: Series, _ raw: Double) -> Double {
        guard mode == .normalized else { return raw }
        let lo = s.min, hi = s.max
        guard hi > lo else { return 50 }
        return (raw - lo) / (hi - lo) * 100
    }

    private func points(for s: Series) -> [(date: String, value: Double)] {
        zip(windowed, s.values).compactMap { day, v in v.map { (date: day.date, value: plotValue(s, $0)) } }
    }

    private var legend: some View {
        Panel(title: "Selected") {
            ForEach(withData, id: \.key) { s in
                Button { toggle(s.key) } label: {
                    HStack(spacing: 8) {
                        Circle().fill(s.color).frame(width: 8, height: 8)
                        Text(s.label).font(.system(size: 13, weight: .medium)).foregroundStyle(Palette.ink(scheme))
                        Spacer()
                        Text("avg \(Format.number(s.avg, decimals: s.decimals))")
                            .font(.system(size: 10)).foregroundStyle(Palette.muted(scheme))
                        Image(systemName: "xmark.circle.fill").font(.system(size: 13)).foregroundStyle(Palette.muted(scheme))
                    }
                }
                .buttonStyle(.plain)
                .padding(.vertical, 4)
            }
        }
    }

    private var picker: some View {
        Panel {
            Button { pickerOpen.toggle() } label: {
                HStack {
                    Text("Metrics").font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.ink(scheme))
                    Spacer()
                    Text("\(selected.count) of \(exploreMaxSeries) selected\(selected.count >= exploreMaxSeries ? " (max)" : "")")
                        .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                    Image(systemName: pickerOpen ? "chevron.up" : "chevron.down")
                        .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                }
            }
            .buttonStyle(.plain)
            if pickerOpen {
                ForEach(exploreGroups, id: \.self) { group in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(group).font(.system(size: 11, weight: .semibold)).textCase(.uppercase)
                            .foregroundStyle(Palette.muted(scheme))
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 108), spacing: 6)], alignment: .leading, spacing: 6) {
                            ForEach(exploreMetrics.filter { $0.group == group }, id: \.key) { metric in
                                let on = selected.contains(metric.key)
                                let full = !on && selected.count >= exploreMaxSeries
                                Button { toggle(metric.key) } label: {
                                    Text(metric.label)
                                        .font(.system(size: 11, weight: .medium))
                                        .padding(.horizontal, 8).padding(.vertical, 5)
                                        .background(on ? colorFor(metric.key).opacity(0.16) : Palette.surface(scheme), in: Capsule())
                                        .foregroundStyle(on ? colorFor(metric.key) : Palette.muted(scheme))
                                        .lineLimit(1)
                                }
                                .buttonStyle(.plain)
                                .disabled(full)
                                .opacity(full ? 0.4 : 1)
                            }
                        }
                    }
                    .padding(.top, 8)
                }
            }
        }
    }

    private func toggle(_ key: String) {
        if let index = selected.firstIndex(of: key) { selected.remove(at: index) }
        else if selected.count < exploreMaxSeries { selected.append(key) }
        UserDefaults.standard.set(selected, forKey: "fuelChartSeries")
    }

    private func colorFor(_ key: String) -> Color {
        guard let index = selected.firstIndex(of: key) else { return Palette.muted(scheme) }
        return exploreSeriesColors[index % exploreSeriesColors.count]
    }
}
