import SwiftUI
import Charts

// The dashboard's front page, reorganised for a phone: the same panels the website
// stacks, in the order you actually want them when standing in a kitchen.

struct TodayView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme
    @State private var filling = false
    @State private var fillProgress = ""

    private var summary: DaySummary? { store.dashboard?.today.summary }
    private var goals: Goals? { store.dashboard?.goals }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    if let summary {
                        energyPanel(summary)
                        macrosPanel(summary)
                        if hasVitals(summary) { vitalsPanel(summary) }
                        foodPanel
                        if let rolling = store.dashboard?.rolling24h { rollingPanel(rolling) }
                    } else if store.loading {
                        ProgressView().padding(40)
                    } else {
                        Panel(title: "No data yet") {
                            Text("Pull to refresh once your first sync completes.")
                                .font(.footnote).foregroundStyle(Palette.muted(scheme))
                        }
                    }
                    if let error = store.error {
                        Panel(title: "Something went wrong") {
                            Text(error).font(.footnote).foregroundStyle(.orange)
                        }
                    }
                }
                .padding(16)
            }
            .background(Palette.background(scheme))
            .navigationTitle("Today")
            .refreshable {
                await store.syncHealth(reason: "pull to refresh")
                await store.load()
            }
        }
    }

    // MARK: Panels

    private func energyPanel(_ s: DaySummary) -> some View {
        Panel(title: "Energy", subtitle: s.partialDay == true ? "Today so far" : nil) {
            HStack(alignment: .top, spacing: 8) {
                Stat(label: "Consumed", value: Format.kcal(s.caloriesConsumed))
                Stat(label: "Burned", value: Format.kcal(s.totalExpenditure))
                Stat(label: "Balance",
                     value: s.energyBalance == nil ? "—" : Format.kcal(s.energyBalance),
                     detail: s.partialDay == true ? "settles at midnight" : nil)
            }
            if let intraday = store.dashboard?.intradayEnergy, !intraday.expenditure.isEmpty {
                intradayChart(intraday)
            }
            GoalBar(label: "Calories", value: s.caloriesConsumed, target: goals?.calories?.target)
        }
    }

    /// The intraday overlay: burn accumulating through the day against food eaten. This
    /// is the chart that could never render on the website until the phone started
    /// writing health_energy_snapshots.
    private func intradayChart(_ intraday: IntradayEnergy) -> some View {
        let parser = ISO8601DateFormatter()
        let burn = intraday.expenditure.compactMap { point -> (Date, Double)? in
            guard let at = parser.date(from: point.collectedAt), let value = point.totalExpenditure else { return nil }
            return (at, value)
        }
        let eaten = intraday.consumed.compactMap { point -> (Date, Double)? in
            guard let at = parser.date(from: point.collectedAt), let value = point.caloriesConsumed else { return nil }
            return (at, value)
        }
        return Chart {
            ForEach(burn, id: \.0) { point in
                LineMark(x: .value("Time", point.0), y: .value("kcal", point.1))
                    .foregroundStyle(Palette.muted(scheme))
                    .interpolationMethod(.monotone)
            }
            ForEach(eaten, id: \.0) { point in
                LineMark(x: .value("Time", point.0), y: .value("kcal", point.1))
                    .foregroundStyle(Palette.flameMid)
                    .interpolationMethod(.stepEnd)
            }
        }
        .chartLegend(.hidden)
        .frame(height: 120)
    }

    private func macrosPanel(_ s: DaySummary) -> some View {
        Panel(title: "Macros") {
            GoalBar(label: "Protein", value: s.protein, target: goals?.protein?.target, unit: " g")
            GoalBar(label: "Carbs", value: s.carbs, target: goals?.carbs?.target, unit: " g")
            GoalBar(label: "Fat", value: s.fat, target: goals?.fat?.target, unit: " g")
            GoalBar(label: "Fiber", value: s.fiber, target: goals?.fiber?.target, unit: " g")
        }
    }

    private func hasVitals(_ s: DaySummary) -> Bool {
        s.stepCount != nil || s.sleepHours != nil || s.restingHeartRate != nil || s.exerciseMinutes != nil
    }

    private func vitalsPanel(_ s: DaySummary) -> some View {
        Panel(title: "Body") {
            HStack(alignment: .top, spacing: 8) {
                Stat(label: "Steps", value: Format.number(s.stepCount))
                Stat(label: "Exercise", value: s.exerciseMinutes == nil ? "—" : "\(Format.number(s.exerciseMinutes))m")
                Stat(label: "Sleep", value: s.sleepHours == nil ? "—" : "\(Format.number(s.sleepHours, decimals: 1))h")
            }
            HStack(alignment: .top, spacing: 8) {
                Stat(label: "Resting HR", value: Format.number(s.restingHeartRate))
                Stat(label: "HRV", value: Format.number(s.hrv))
                Stat(label: "VO₂ max", value: Format.number(s.vo2Max, decimals: 1))
            }
        }
    }

    private var missing: [FoodEntry] {
        store.dashboard?.today.foodEntries.filter { $0.needsNutrition } ?? []
    }

    private var foodPanel: some View {
        Panel(title: "Food", subtitle: store.dashboard?.today.foodEntries.isEmpty == true ? "Nothing logged yet" : nil) {
            ForEach(store.dashboard?.today.foodEntries ?? []) { entry in
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry.food ?? "—").font(.system(size: 15, weight: .medium))
                            .foregroundStyle(Palette.ink(scheme))
                        Text([entry.time, entry.portion].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Palette.muted(scheme))
                    }
                    Spacer()
                    Text(entry.calories == nil ? "—" : "\(Format.kcal(entry.calories)) kcal")
                        .font(.system(size: 14, design: .rounded))
                        .foregroundStyle(entry.calories == nil ? Palette.muted(scheme) : Palette.ink(scheme))
                }
                .padding(.vertical, 4)
                .swipeActions {
                    Button(role: .destructive) {
                        Task { await store.deleteFood(entry) }
                    } label: { Label("Delete", systemImage: "trash") }
                }
                Divider().opacity(0.4)
            }

            if !missing.isEmpty {
                Button {
                    filling = true
                    Task {
                        await store.fillMissingNutrition { done, total in
                            fillProgress = "\(done) of \(total)"
                        }
                        filling = false
                        fillProgress = ""
                    }
                } label: {
                    HStack {
                        if filling { ProgressView().controlSize(.small) } else { Image(systemName: "sparkles") }
                        Text(filling ? "Estimating \(fillProgress)…" : "Fill \(missing.count) with on-device AI")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(filling || !OnDeviceAI.shared.availability.isReady)
            }
        }
    }

    private func rollingPanel(_ rolling: Rolling24h) -> some View {
        Panel(title: "Rolling 24 hours") {
            HStack(alignment: .top, spacing: 8) {
                Stat(label: "Consumed", value: Format.kcal(rolling.consumed))
                Stat(label: "Burned", value: Format.kcal(rolling.burned))
                Stat(label: "Balance", value: Format.kcal(rolling.balance))
            }
        }
    }
}
