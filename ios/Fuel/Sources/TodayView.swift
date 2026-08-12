import SwiftUI
import UIKit
import Charts
import UniformTypeIdentifiers

// The website's dashboard, whole. Same eight sections in the same order, the same six
// energy boxes, the same 39-nutrient grid, the same metric cards — and the same edit
// controls: food entries, goals, past-day energy, and which sections show at all.
//
// The layout is server-backed, so reordering here reorders the website too. That is the
// point of replicating rather than reimagining: one dashboard, two windows onto it.
//
// Customising the layout is a long-press away, not a separate settings sheet: hold any
// card and the whole dashboard jiggles, the way Home Screen icons do. Each card gets a
// hide/show badge and becomes draggable for reordering while jiggling; tapping Done
// saves the result. There is no website equivalent for this interaction (the website
// uses a hide/reorder list) — this is the same underlying layout, edited the way a
// phone actually expects it to be edited.

enum EnergyRangeKey: String, CaseIterable { case day = "Day", week = "Week", month = "Month" }

struct TodayView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme

    @State private var editingFood: FoodEntry?
    @State private var showGoals = false
    @State private var showHistory = false
    @State private var showColors = false
    @State private var filling = false
    @State private var fillProgress = ""
    @State private var range: EnergyRangeKey = .day

    @State private var dashboardEditing = false
    @State private var draftLayout = DashboardLayout.default
    @State private var draggingKey: String?

    private var summary: DaySummary? { store.dashboard?.today.summary }
    private var goals: Goals? { store.dashboard?.goals }

    /// The layout being displayed: the live, server-synced one normally, or the local
    /// in-progress draft while jiggling — so every edit previews instantly and nothing
    /// is written until Done.
    private var activeLayout: DashboardLayout { dashboardEditing ? draftLayout : store.layout }
    private var displayedKeys: [String] {
        dashboardEditing ? activeLayout.order : activeLayout.order.filter { !activeLayout.hidden.contains($0) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    if let summary {
                        if !dashboardEditing {
                            VitalsSignalBar(trends: store.dashboard?.trends ?? [], summary: summary)
                        }
                        energyHero(summary)
                        ForEach(displayedKeys, id: \.self) { key in
                            cardWrapper(key) { section(key, summary) }
                        }
                        if !dashboardEditing { coveragePanel }
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
                .frame(maxWidth: .infinity)
            }
            .background(Palette.background(scheme))
            .navigationTitle("Today")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if dashboardEditing {
                        Button("Done") { endEditing() }.fontWeight(.semibold)
                    } else {
                        Menu {
                            Button { showGoals = true } label: { Label("Edit goals", systemImage: "target") }
                            Button { showHistory = true; Task { await store.loadHistory() } } label: {
                                Label("Edit past days", systemImage: "calendar")
                            }
                            Button { beginEditing() } label: { Label("Customise dashboard", systemImage: "square.grid.2x2") }
                            Button { showColors = true } label: { Label("Dashboard colors", systemImage: "paintpalette") }
                        } label: { Image(systemName: "ellipsis.circle") }
                    }
                }
            }
            .refreshable {
                await store.syncHealth(reason: "pull to refresh")
                await store.load()
            }
            .sheet(item: $editingFood) { EditFoodSheet(entry: $0) }
            .sheet(isPresented: $showGoals) { GoalsSheet() }
            .sheet(isPresented: $showColors) { DashboardColorsSheet() }
            .sheet(isPresented: $showHistory) { HistorySheet() }
        }
    }

    // MARK: Jiggle-mode dashboard editing

    private func beginEditing() {
        draftLayout = store.layout
        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.impactOccurred()
        withAnimation(.spring(response: 0.3, dampingFraction: 0.65)) { dashboardEditing = true }
    }

    private func endEditing() {
        withAnimation { dashboardEditing = false }
        Task { await store.saveLayout(draftLayout) }
    }

    private func toggleHidden(_ key: String) {
        if draftLayout.hidden.contains(key) { draftLayout.hidden.removeAll { $0 == key } }
        else { draftLayout.hidden.append(key) }
    }

    /// Re-adding a box restores it to its canonical position rather than appending it
    /// at the end, matching the website's own toggleBox reducer.
    private func toggleEnergyBox(_ key: String) {
        if draftLayout.energyBoxes.contains(key) { draftLayout.energyBoxes.removeAll { $0 == key } }
        else { draftLayout.energyBoxes = DashboardLayout.allEnergyBoxes.filter { $0 == key || draftLayout.energyBoxes.contains($0) } }
    }

    /// Wraps one section's card with the jiggle animation, its hide/show badge, and
    /// drag-to-reorder — only active while dashboardEditing.
    @ViewBuilder
    private func cardWrapper<Content: View>(_ key: String, @ViewBuilder content: () -> Content) -> some View {
        let hidden = activeLayout.hidden.contains(key)
        let card = content()
            .opacity(dashboardEditing && hidden ? 0.4 : 1)
            .jiggling(dashboardEditing, seed: key)
            .overlay(alignment: .topLeading) {
                if dashboardEditing {
                    Button { toggleHidden(key) } label: {
                        Image(systemName: hidden ? "plus.circle.fill" : "minus.circle.fill")
                            .font(.system(size: 24))
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(.white, hidden ? .green : .red)
                    }
                    .offset(x: -8, y: -8)
                    .transition(.scale.combined(with: .opacity))
                }
            }
        // Drag-to-reorder only engages once already jiggling — outside edit mode a
        // long press is what starts it, exactly like the Home Screen.
        if dashboardEditing {
            card
                .onDrag {
                    draggingKey = key
                    return NSItemProvider(object: key as NSString)
                }
                .onDrop(of: [.text], delegate: SectionDropDelegate(item: key, layout: $draftLayout, draggingItem: $draggingKey))
        } else {
            card.onLongPressGesture(minimumDuration: 0.4) { beginEditing() }
        }
    }

    // MARK: Energy hero — headline, range tabs, the six boxes, and the two trend charts

    private var rangeDays: Int {
        switch range { case .day: return 1; case .week: return 7; case .month: return 30 }
    }
    private var rangeVisible: [DaySummary] { Array((store.dashboard?.trends ?? []).suffix(rangeDays)) }
    private var rangeBalance: Double? {
        let consumed = rangeVisible.reduce(0.0) { $0 + ($1.caloriesConsumed ?? 0) }
        let expended = rangeVisible.reduce(0.0) { $0 + ($1.totalExpenditure ?? 0) }
        return (consumed > 0 && expended > 0) ? consumed - expended : nil
    }

    @ViewBuilder
    private func energyHero(_ s: DaySummary) -> some View {
        Panel {
            VStack(alignment: .leading, spacing: 3) {
                Text("ENERGY BALANCE").font(.system(size: 11, weight: .semibold)).kerning(0.6)
                    .foregroundStyle(Palette.muted(scheme))
                Text(rangeBalance == nil ? "Incomplete data"
                     : rangeBalance! > 0 ? "\(Format.number(rangeBalance)) kcal surplus" : "\(Format.number(abs(rangeBalance!))) kcal deficit")
                    .font(.system(size: 26, weight: .bold, design: .rounded)).foregroundStyle(Palette.ink(scheme))
                Text("\(range == .day ? "Today" : range == .week ? "Last 7 days" : "Last 30 days") · intake versus total expenditure")
                    .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
            }
            Picker("Range", selection: $range) {
                ForEach(EnergyRangeKey.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.top, 2)

            if dashboardEditing {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(DashboardLayout.allEnergyBoxes, id: \.self) { key in energyBoxTile(key, s) }
                }
                .padding(.top, 6)
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(Array(Self.chartLabels.keys.sorted()), id: \.self) { key in chartToggleTile(key) }
                }
                .padding(.top, 8)
            } else {
                EnergySummaryBars(summary: s, rolling24h: store.dashboard?.rolling24h, boxes: activeLayout.energyBoxes)
                    .padding(.top, 10)
            }

            Group {
                if activeLayout.charts.contains("intraday"), let intraday = store.dashboard?.intradayEnergy {
                    intradayChart(intraday)
                }
                if let averages = store.dashboard?.energyAverages {
                    Divider()
                    HStack(alignment: .top, spacing: 8) {
                        Stat(label: "Avg burned", value: Format.kcal(averages.totalExpenditure))
                        Stat(label: "Avg resting", value: Format.kcal(averages.restingEnergy))
                        Stat(label: "Avg active", value: Format.kcal(averages.activeEnergy))
                        // Sign is the point here, so it carries the same two colours as
                        // the bars below rather than the neutral ink the others use.
                        if let balance = averages.energyBalance {
                            Stat(label: balance > 0 ? "Avg surplus" : "Avg deficit",
                                 value: Format.kcal(abs(balance)),
                                 tint: balance > 0 ? DashboardTheme.shared.positive
                                                   : DashboardTheme.shared.negative)
                        }
                    }
                }
                Divider()
                NetBalanceTrendChart(trends: Array((store.dashboard?.trends ?? []).suffix(30)))
            }
        }
    }

    // "components" stays in the layout schema (the server and website still round-trip
    // it) but the grouped-bar chart it controlled is gone, so it is not offered here.
    private static let chartLabels = ["intraday": "Daily intake"]

    /// Same shape as energyBoxTile — a compact chip that's both the preview and the
    /// toggle — but for the two big charts rather than a numeric stat, so there's
    /// nothing to render inline except the label and its on/off badge.
    @ViewBuilder
    private func chartToggleTile(_ key: String) -> some View {
        let hidden = !draftLayout.charts.contains(key)
        HStack(spacing: 6) {
            Image(systemName: "chart.xyaxis.line").font(.system(size: 12))
            Text(Self.chartLabels[key] ?? key).font(.system(size: 13, weight: .medium))
        }
        .foregroundStyle(Palette.ink(scheme))
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(Palette.surface(scheme))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .opacity(hidden ? 0.35 : 1)
        .jiggling(dashboardEditing, seed: key)
        .overlay(alignment: .topTrailing) {
            Button { toggleChart(key) } label: {
                Image(systemName: hidden ? "plus.circle.fill" : "minus.circle.fill")
                    .font(.system(size: 17))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, hidden ? .green : .red)
            }
            .offset(x: 6, y: -6)
        }
    }

    /// Re-adding a chart restores it to its canonical position, matching toggleEnergyBox.
    private func toggleChart(_ key: String) {
        if draftLayout.charts.contains(key) { draftLayout.charts.removeAll { $0 == key } }
        else { draftLayout.charts = DashboardLayout.allCharts.filter { $0 == key || draftLayout.charts.contains($0) } }
    }

    @ViewBuilder
    private func energyBoxTile(_ key: String, _ s: DaySummary) -> some View {
        let hidden = !activeLayout.energyBoxes.contains(key)
        Group {
            switch key {
            case "totalBurned": Stat(label: "Total burned", value: Format.kcal(s.totalExpenditure))
            case "consumed": Stat(label: "Consumed", value: Format.kcal(s.caloriesConsumed))
            case "active": Stat(label: "Active", value: Format.kcal(s.activeEnergy))
            case "resting": Stat(label: "Resting", value: Format.kcal(s.restingEnergy))
            case "deficit":
                let total = s.totalExpenditure ?? ((s.restingEnergy ?? 0) + (s.activeEnergy ?? 0))
                let balance = total - (s.caloriesConsumed ?? 0)
                Stat(label: balance >= 0 ? "Deficit" : "Surplus", value: Format.kcal(abs(balance)),
                     detail: s.partialDay == true ? "settles at midnight" : nil)
            case "rolling24":
                let r = store.dashboard?.rolling24h?.balance
                Stat(label: "24h \(r != nil && r! < 0 ? "deficit" : "surplus")", value: Format.kcal(r.map(abs)))
            default: EmptyView()
            }
        }
        .opacity(dashboardEditing && hidden ? 0.35 : 1)
        .jiggling(dashboardEditing, seed: key)
        .overlay(alignment: .topTrailing) {
            if dashboardEditing {
                Button { toggleEnergyBox(key) } label: {
                    Image(systemName: hidden ? "plus.circle.fill" : "minus.circle.fill")
                        .font(.system(size: 17))
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, hidden ? .green : .red)
                }
                .offset(x: 6, y: -4)
            }
        }
    }

    /// nil (rather than an empty Chart with no marks) when there's genuinely nothing
    /// to plot yet — an empty Chart still draws axes, which reads as "broken", not
    /// "no data".
    @ViewBuilder
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
        if burn.isEmpty && eaten.isEmpty {
            EmptyView()
        } else {
            Chart {
                ForEach(burn, id: \.0) { point in
                    LineMark(x: .value("Time", point.0), y: .value("kcal", point.1))
                        .foregroundStyle(Palette.muted(scheme)).interpolationMethod(.monotone)
                }
                ForEach(eaten, id: \.0) { point in
                    LineMark(x: .value("Time", point.0), y: .value("kcal", point.1))
                        .foregroundStyle(DashboardTheme.shared.primary).interpolationMethod(.stepEnd)
                }
            }
            .chartLegend(.hidden)
            .frame(height: 120)
        }
    }

    // MARK: The eight sections

    @ViewBuilder
    private func section(_ key: String, _ s: DaySummary) -> some View {
        switch key {
        case "nutrition": nutritionSection(s)
        case "detailedNutrition": nutrientGrid(s)
        case "foodConsumed": foodSection
        case "fitness":
            VStack(spacing: 14) {
                ActivityRingsCard(
                    move: s.activeEnergy ?? 0, moveTarget: goals?.move?.target ?? 1000,
                    exercise: s.exerciseMinutes ?? 0, exerciseTarget: goals?.exercise?.target ?? 80,
                    stand: s.standMinutes ?? 0, standTarget: goals?.stand?.target ?? 120)
                metricSection("Fitness", fitnessMetrics(s))
            }
        case "workouts": workoutsSection
        case "steps":
            Panel(title: "Steps") {
                TrendLineChart(title: "Daily steps", unit: "steps", decimals: 0,
                               points: trendPoints { $0.stepCount })
            }
        case "vitals":
            VStack(spacing: 14) {
                metricSection("Vitals", vitalsMetrics(s))
                vitalsOverTimePanel
            }
        case "recovery":
            Panel(title: "Recovery") {
                Stat(label: "Sleep", value: s.sleepHours == nil ? "—" : "\(Format.number(s.sleepHours, decimals: 1)) h")
                TrendLineChart(title: "Sleep duration", unit: "h", decimals: 1,
                               points: trendPoints { $0.sleepHours })
            }
        default: EmptyView()
        }
    }

    /// Same ordering, and the same "only show if it's ever actually happened" gating,
    /// as the website's positive(...) checks around the optional fitness metrics.
    private func fitnessMetrics(_ s: DaySummary) -> [(String, Double?, String, Int)] {
        var items: [(String, Double?, String, Int)] = [
            ("Active energy", s.activeEnergy, "kcal", 0),
            ("Exercise", s.exerciseMinutes, "min", 0),
            ("Walking + running", s.distanceMiles, "mi", 2),
        ]
        if let v = s.runningStrideLength, v > 0 { items.append(("Running stride length", v, "m", 2)) }
        items.append(("Steps", s.stepCount, "", 0))
        if let v = s.standMinutes, v > 0 { items.append(("Stand time", v, "min", 0)) }
        if let v = s.flightsClimbed, v > 0 { items.append(("Flights climbed", v, "flights", 0)) }
        if let v = s.cyclingDistanceMiles, v > 0 { items.append(("Cycling distance", v, "mi", 2)) }
        return items
    }

    private func vitalsMetrics(_ s: DaySummary) -> [(String, Double?, String, Int)] {
        var items: [(String, Double?, String, Int)] = [
            ("Resting heart rate", s.restingHeartRate, "bpm", 0),
            ("HRV", s.hrv, "ms", 0),
            ("Respiratory rate", s.respiratoryRate, "/min", 1),
            ("VO₂ max", s.vo2Max, "", 1),
        ]
        if let v = s.bloodOxygen, v > 0 { items.append(("Blood oxygen", v, "%", 1)) }
        if let v = s.walkingHeartRateAverage, v > 0 { items.append(("Walking heart rate", v, "bpm avg", 0)) }
        if let v = s.cardioRecovery, v > 0 { items.append(("Cardio recovery", v, "bpm", 1)) }
        return items
    }

    /// One small trend chart per vital that has at least two points to draw a line
    /// through — matching the website's VitalTrends panel below the Vitals grid.
    @ViewBuilder
    private var vitalsOverTimePanel: some View {
        let charts: [(String, String, Int, (DaySummary) -> Double?)] = [
            ("Resting heart rate", "bpm", 0, { $0.restingHeartRate }),
            ("HRV", "ms", 0, { $0.hrv }),
            ("VO₂ max", "mL/kg/min", 1, { $0.vo2Max }),
            ("Walking heart rate", "bpm", 0, { $0.walkingHeartRateAverage }),
            ("Respiratory rate", "/min", 1, { $0.respiratoryRate }),
            ("Blood oxygen", "%", 1, { $0.bloodOxygen }),
            ("Cardio recovery", "bpm", 1, { $0.cardioRecovery }),
        ].filter { trendPoints($0.3).count >= 2 }
        if !charts.isEmpty {
            Panel(title: "Vitals over time") {
                VStack(spacing: 18) {
                    ForEach(charts, id: \.0) { title, unit, decimals, pick in
                        TrendLineChart(title: title, unit: unit, decimals: decimals, points: trendPoints(pick))
                    }
                }
            }
        }
    }

    private func trendPoints(_ pick: (DaySummary) -> Double?) -> [(date: String, value: Double)] {
        (store.dashboard?.trends ?? []).compactMap { day in pick(day).map { (day.date, $0) } }
    }

    private func nutritionSection(_ s: DaySummary) -> some View {
        Panel(title: "Nutrition") {
            HStack(alignment: .top, spacing: 22) {
                VStack(spacing: 8) {
                    CalorieRing(value: s.caloriesConsumed, target: goals?.calories?.target, unit: "kcal")
                    Text("Calculated calories").font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.muted(scheme))
                        .multilineTextAlignment(.center).frame(maxWidth: 148)
                }
                VStack(spacing: 10) {
                    GoalBar(label: "Protein", value: s.protein, target: goals?.protein?.target, unit: " g")
                    GoalBar(label: "Carbohydrates", value: s.carbs, target: goals?.carbs?.target, unit: " g")
                    GoalBar(label: "Fat", value: s.fat, target: goals?.fat?.target, unit: " g")
                    GoalBar(label: "Fiber", value: s.fiber, target: goals?.fiber?.target, unit: " g")
                }
            }
            Divider()
            GoalBar(label: "Move", value: s.activeEnergy, target: goals?.move?.target, unit: " kcal")
            GoalBar(label: "Exercise", value: s.exerciseMinutes, target: goals?.exercise?.target, unit: " min")
            GoalBar(label: "Stand", value: s.standMinutes, target: goals?.stand?.target, unit: " min")
            GoalBar(label: "Steps", value: s.stepCount, target: goals?.steps?.target)
            GoalBar(label: "Sleep", value: s.sleepHours, target: goals?.sleepHours?.target, unit: " h")
        }
    }

    private func nutrientGrid(_ s: DaySummary) -> some View {
        let tracked = Nutrient.display.compactMap { item -> (Nutrient, Double)? in
            guard let value = s.nutrients?[item.key] else { return nil }
            return (item, value)
        }
        return Panel(title: "Detailed nutrition") {
            if tracked.isEmpty {
                Text("Detailed nutrients will appear as newly logged foods include them.")
                    .font(.footnote).foregroundStyle(Palette.muted(scheme))
            } else {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(tracked, id: \.0.key) { item, value in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.label).font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                            HStack(spacing: 3) {
                                Text(Format.number(value, decimals: item.decimals))
                                    .font(.system(size: 17, weight: .medium, design: .rounded))
                                Text(item.unit).font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }

    private var missing: [FoodEntry] {
        store.dashboard?.today.foodEntries.filter { $0.needsNutrition } ?? []
    }

    private var foodSection: some View {
        Panel(title: "Food consumed",
              subtitle: store.dashboard?.today.foodEntries.isEmpty == true ? "Nothing logged yet" : nil) {
            ForEach(store.dashboard?.today.foodEntries ?? []) { entry in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.food ?? entry.meal ?? "—")
                                .font(.system(size: 15, weight: .medium)).foregroundStyle(Palette.ink(scheme))
                            Text([entry.time, entry.meal, entry.portion]
                                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.caption).foregroundStyle(Palette.muted(scheme))
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 2) {
                            Text(entry.calories == nil ? "—" : "\(Format.kcal(entry.calories)) kcal")
                                .font(.system(size: 14, weight: .medium, design: .rounded))
                            Text("\(Format.number(entry.protein, decimals: 1))p · \(Format.number(entry.carbs, decimals: 1))c · \(Format.number(entry.fat, decimals: 1))f · \(Format.number(entry.fiber, decimals: 1))fib")
                                .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                        }
                    }
                    HStack(spacing: 8) {
                        Button { editingFood = entry } label: {
                            Label("Edit", systemImage: "pencil").font(.caption)
                        }
                        .buttonStyle(.bordered).controlSize(.small)
                        Button(role: .destructive) {
                            Task { await store.deleteFood(entry) }
                        } label: { Label("Delete", systemImage: "trash").font(.caption) }
                        .buttonStyle(.bordered).controlSize(.small)
                    }
                }
                .padding(.vertical, 6)
                Divider().opacity(0.4)
            }

            if !missing.isEmpty {
                HStack(spacing: 10) {
                    Text("\(missing.count) \(missing.count == 1 ? "entry is" : "entries are") missing nutrition detail.")
                        .font(.caption).foregroundStyle(Palette.muted(scheme))
                    Spacer()
                    Button {
                        filling = true
                        Task {
                            await store.fillMissingNutrition { done, total in fillProgress = "\(done)/\(total)" }
                            filling = false; fillProgress = ""
                        }
                    } label: {
                        HStack(spacing: 5) {
                            if filling { ProgressView().controlSize(.small) } else { Image(systemName: "sparkles") }
                            Text(filling ? fillProgress : "Fill in with AI").font(.caption)
                        }
                    }
                    .buttonStyle(.bordered).controlSize(.small)
                    .disabled(filling || !OnDeviceAI.shared.isUsable)
                }
            }
        }
    }

    private var workoutsSection: some View {
        Panel(title: "Workouts") {
            let workouts = store.dashboard?.today.workouts ?? []
            if workouts.isEmpty {
                Text("No workouts recorded today.").font(.footnote).foregroundStyle(Palette.muted(scheme))
            } else {
                ForEach(workouts) { workout in
                    HStack {
                        Text(workout.activity ?? "Activity").font(.system(size: 15, weight: .medium))
                        Spacer()
                        Text([
                            workout.swimmingDistanceYards.map { "\(Format.number($0)) yd" },
                            workout.distanceMiles.map { "\(Format.number($0, decimals: 2)) mi" },
                            workout.stepCount.map { "\(Format.number($0)) steps" },
                        ].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Palette.muted(scheme))
                    }
                    .padding(.vertical, 3)
                }
            }
            let supplements = store.dashboard?.today.supplements ?? []
            if !supplements.isEmpty {
                Divider()
                ForEach(supplements) { supplement in
                    HStack {
                        Text(supplement.name ?? "—").font(.system(size: 14))
                        Spacer()
                        Text([supplement.time, supplement.dose].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Palette.muted(scheme))
                    }
                }
            }
        }
    }

    private func metricSection(_ title: String, _ metrics: [(String, Double?, String, Int)]) -> some View {
        Panel(title: title) {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 14) {
                ForEach(metrics, id: \.0) { label, value, unit, decimals in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(label).font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                        HStack(spacing: 3) {
                            Text(Format.number(value, decimals: decimals))
                                .font(.system(size: 20, weight: .semibold, design: .rounded))
                            if value != nil, !unit.isEmpty {
                                Text(unit).font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private var coveragePanel: some View {
        Panel(title: "Coverage") {
            HStack(alignment: .top, spacing: 8) {
                Stat(label: "Days", value: "\(store.dashboard?.coverage?.days ?? 0)")
                Stat(label: "Food entries", value: "\(store.dashboard?.coverage?.foodEntries ?? 0)")
            }
        }
    }
}

/// The website's NUTRIENT_DISPLAY, transcribed — same keys, labels, units and precision,
/// so a number reads identically on both surfaces.
struct Nutrient {
    let key: String, label: String, unit: String, decimals: Int

    static let display: [Nutrient] = [
        .init(key: "sugarsG", label: "Total sugars", unit: "g", decimals: 1),
        .init(key: "addedSugarsG", label: "Added sugars", unit: "g", decimals: 1),
        .init(key: "sodiumMg", label: "Sodium", unit: "mg", decimals: 0),
        .init(key: "caffeineMg", label: "Caffeine", unit: "mg", decimals: 0),
        .init(key: "saturatedFatG", label: "Saturated fat", unit: "g", decimals: 1),
        .init(key: "transFatG", label: "Trans fat", unit: "g", decimals: 1),
        .init(key: "monounsaturatedFatG", label: "Monounsaturated fat", unit: "g", decimals: 1),
        .init(key: "polyunsaturatedFatG", label: "Polyunsaturated fat", unit: "g", decimals: 1),
        .init(key: "omega3G", label: "Omega-3", unit: "g", decimals: 2),
        .init(key: "omega6G", label: "Omega-6", unit: "g", decimals: 2),
        .init(key: "cholesterolMg", label: "Cholesterol", unit: "mg", decimals: 0),
        .init(key: "starchG", label: "Starch", unit: "g", decimals: 1),
        .init(key: "sugarAlcoholG", label: "Sugar alcohol", unit: "g", decimals: 1),
        .init(key: "potassiumMg", label: "Potassium", unit: "mg", decimals: 0),
        .init(key: "calciumMg", label: "Calcium", unit: "mg", decimals: 0),
        .init(key: "ironMg", label: "Iron", unit: "mg", decimals: 1),
        .init(key: "magnesiumMg", label: "Magnesium", unit: "mg", decimals: 0),
        .init(key: "phosphorusMg", label: "Phosphorus", unit: "mg", decimals: 0),
        .init(key: "zincMg", label: "Zinc", unit: "mg", decimals: 1),
        .init(key: "copperMg", label: "Copper", unit: "mg", decimals: 2),
        .init(key: "manganeseMg", label: "Manganese", unit: "mg", decimals: 2),
        .init(key: "seleniumMcg", label: "Selenium", unit: "mcg", decimals: 1),
        .init(key: "iodineMcg", label: "Iodine", unit: "mcg", decimals: 1),
        .init(key: "vitaminAMcg", label: "Vitamin A", unit: "mcg", decimals: 0),
        .init(key: "vitaminCMg", label: "Vitamin C", unit: "mg", decimals: 1),
        .init(key: "vitaminDMcg", label: "Vitamin D", unit: "mcg", decimals: 1),
        .init(key: "vitaminEMg", label: "Vitamin E", unit: "mg", decimals: 1),
        .init(key: "vitaminKMcg", label: "Vitamin K", unit: "mcg", decimals: 1),
        .init(key: "thiaminMg", label: "Thiamin (B1)", unit: "mg", decimals: 2),
        .init(key: "riboflavinMg", label: "Riboflavin (B2)", unit: "mg", decimals: 2),
        .init(key: "niacinMg", label: "Niacin (B3)", unit: "mg", decimals: 1),
        .init(key: "pantothenicAcidMg", label: "Pantothenic acid (B5)", unit: "mg", decimals: 1),
        .init(key: "vitaminB6Mg", label: "Vitamin B6", unit: "mg", decimals: 2),
        .init(key: "biotinMcg", label: "Biotin (B7)", unit: "mcg", decimals: 1),
        .init(key: "folateMcg", label: "Folate (B9)", unit: "mcg", decimals: 0),
        .init(key: "vitaminB12Mcg", label: "Vitamin B12", unit: "mcg", decimals: 1),
        .init(key: "cholineMg", label: "Choline", unit: "mg", decimals: 0),
        .init(key: "waterMl", label: "Water", unit: "mL", decimals: 0),
        .init(key: "alcoholG", label: "Alcohol", unit: "g", decimals: 1),
    ]
}

/// The website's calorie ring (.ring — a conic-gradient donut), transcribed: a hard
/// black arc on a light track, capped at 100%, with the value and target centred.
struct CalorieRing: View {
    @Environment(\.colorScheme) private var scheme
    let value: Double?
    let target: Double?
    let unit: String

    private var pct: Double {
        guard let value, let target, target > 0 else { return 0 }
        return min(1, max(0, value / target))
    }

    var body: some View {
        ZStack {
            Circle().stroke(Palette.surface(scheme), lineWidth: 16)
            Circle()
                .trim(from: 0, to: pct)
                .stroke(Palette.ink(scheme), style: StrokeStyle(lineWidth: 16, lineCap: .butt))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 2) {
                Text(Format.number(value)).font(.system(size: 26, weight: .semibold, design: .rounded))
                    .foregroundStyle(Palette.ink(scheme))
                Text("of \(Format.number(target)) \(unit)").font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
            }
        }
        .frame(width: 148, height: 148)
    }
}

/// The website's Activity Rings card (.activity-rings): a fixed dark tile — not
/// theme-adaptive, same as the website's own #202124 — with Apple's own Move/Exercise/
/// Stand ring colours, since this one card is deliberately the app's other splash of
/// colour besides the flame mark.
struct ActivityRingsCard: View {
    let move: Double
    let moveTarget: Double
    let exercise: Double
    let exerciseTarget: Double
    let stand: Double
    let standTarget: Double

    private static let moveColor = Color(hex: 0xff2d55)
    private static let moveTrack = Color(hex: 0x54162a)
    private static let exerciseColor = Color(hex: 0xa8ff00)
    private static let exerciseTrack = Color(hex: 0x35510a)
    private static let standColor = Color(hex: 0x00e5f0)
    private static let standTrack = Color(hex: 0x07515a)

    var body: some View {
        HStack(spacing: 24) {
            ZStack {
                ring(move, moveTarget, track: Self.moveTrack, progress: Self.moveColor, lineWidth: 20, diameter: 168)
                ring(exercise, exerciseTarget, track: Self.exerciseTrack, progress: Self.exerciseColor, lineWidth: 18, diameter: 118)
                ring(stand, standTarget, track: Self.standTrack, progress: Self.standColor, lineWidth: 16, diameter: 76)
            }
            .frame(width: 168, height: 168)
            VStack(alignment: .leading, spacing: 16) {
                ringRow("Move", move, moveTarget, "CAL", Self.moveColor)
                ringRow("Exercise", exercise, exerciseTarget, "MIN", Self.exerciseColor)
                ringRow("Stand", stand, standTarget, "MIN", Self.standColor)
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .background(Color(hex: 0x202124))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func ring(_ value: Double, _ target: Double, track: Color, progress: Color, lineWidth: CGFloat, diameter: CGFloat) -> some View {
        let pct = target > 0 ? min(1, max(0, value / target)) : 0
        return ZStack {
            Circle().stroke(track, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: pct)
                .stroke(progress, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: diameter, height: diameter)
    }

    private func ringRow(_ label: String, _ value: Double, _ target: Double, _ unit: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 13)).foregroundStyle(.white.opacity(0.85))
            HStack(alignment: .lastTextBaseline, spacing: 4) {
                Text("\(Format.number(value))/\(Format.number(target))")
                    .font(.system(size: 22, weight: .medium, design: .rounded))
                Text(unit).font(.system(size: 11, weight: .bold))
            }
            .foregroundStyle(color)
        }
    }
}

/// The website's InteractiveLine (ink line + soft area fill), simplified to native
/// Charts: no draggable tooltip, but the same shape, colour and one-glance readability.
struct TrendLineChart: View {
    @Environment(\.colorScheme) private var scheme
    let title: String
    let unit: String
    let decimals: Int
    let points: [(date: String, value: Double)]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.ink(scheme))
            if points.count < 2 {
                Text("Insufficient data").font(.footnote).foregroundStyle(Palette.muted(scheme))
                    .frame(maxWidth: .infinity, minHeight: 80, alignment: .center)
            } else {
                Chart(points, id: \.date) { point in
                    AreaMark(x: .value("Date", point.date), y: .value(unit, point.value))
                        .foregroundStyle(.linearGradient(colors: [Palette.ink(scheme).opacity(0.16), .clear],
                                                         startPoint: .top, endPoint: .bottom))
                        .interpolationMethod(.monotone)
                    LineMark(x: .value("Date", point.date), y: .value(unit, point.value))
                        .foregroundStyle(Palette.ink(scheme))
                        .interpolationMethod(.monotone)
                }
                .chartXAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
                .chartYAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
                .frame(height: 150)
            }
        }
    }
}

// MARK: - Jiggle-mode plumbing

private extension View {
    /// The Home Screen wobble: a small looping rotation, out of phase per card (seeded
    /// from its key) so a whole screen of cards doesn't move in lockstep.
    func jiggling(_ active: Bool, seed: String) -> some View {
        modifier(JiggleModifier(active: active, seed: seed))
    }
}

private struct JiggleModifier: ViewModifier {
    let active: Bool
    let seed: String
    @State private var tilted = false

    private var delay: Double { Double(abs(seed.hashValue) % 70) / 1000 }

    func body(content: Content) -> some View {
        content
            .rotationEffect(.degrees(active ? (tilted ? -1.4 : 1.4) : 0))
            .animation(active ? .easeInOut(duration: 0.14).delay(delay).repeatForever(autoreverses: true) : .default, value: tilted)
            .onAppear { if active { tilted = true } }
            .onChange(of: active) { _, isActive in tilted = isActive }
    }
}

/// Reorders draftLayout.order live as one card drags over another, mirroring how
/// Home Screen icons swap position mid-drag rather than only on release.
private struct SectionDropDelegate: DropDelegate {
    let item: String
    @Binding var layout: DashboardLayout
    @Binding var draggingItem: String?

    func dropEntered(info: DropInfo) {
        guard let dragging = draggingItem, dragging != item,
              let from = layout.order.firstIndex(of: dragging),
              let to = layout.order.firstIndex(of: item) else { return }
        withAnimation {
            layout.order.move(fromOffsets: IndexSet(integer: from), toOffset: to > from ? to + 1 : to)
        }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }
    func performDrop(info: DropInfo) -> Bool { draggingItem = nil; return true }
}

// MARK: - Energy trend charts (top of dashboard)

/// The website's NetBalanceChart: one bar per day, up for surplus, down for deficit,
/// split by a zero line.
struct NetBalanceTrendChart: View {
    @Environment(\.colorScheme) private var scheme
    let trends: [DaySummary]

    @State private var visibleCount: Double
    @GestureState private var magnifyBy: CGFloat = 1
    @State private var selectedDate: String?

    /// Today plus the previous three. A month of daily bars at phone width is a smear,
    /// and the question this chart answers is almost always about the last few days.
    private static let defaultWindow = 4

    init(trends: [DaySummary]) {
        self.trends = trends
        _visibleCount = State(initialValue: Double(min(Self.defaultWindow, max(trends.count, 1))))
    }

    /// The date the visible window should start at so it *ends* on the most recent day.
    /// chartScrollPosition anchors the leading edge, so scrolling to the last date alone
    /// would park today at the far left with empty space after it.
    private var initialScrollDate: String {
        let start = max(0, points.count - Self.defaultWindow)
        return points.indices.contains(start) ? points[start].date : (points.last?.date ?? "")
    }

    private var points: [(date: String, net: Double?)] {
        trends.map { day in
            let net: Double? = (day.caloriesConsumed != nil && day.totalExpenditure != nil)
                ? day.caloriesConsumed! - day.totalExpenditure! : nil
            return (day.date, net)
        }
    }

    /// "Mon Aug 11" — an ISO date on a tick mark is unreadable at a glance, and the
    /// weekday is most of why anyone looks at this chart ("what happened on Saturday?").
    static func label(for iso: String) -> String {
        guard let date = Self.isoFormatter.date(from: iso) else { return iso }
        return Self.displayFormatter.string(from: date)
    }

    private static let isoFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = .current
        return f
    }()

    private static let displayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEE MMM d")
        return f
    }()

    private var selectedPoint: (date: String, net: Double?)? {
        guard let selectedDate else { return nil }
        return points.first { $0.date == selectedDate }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Daily deficit and surplus").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.ink(scheme))
                Spacer()
                if points.count > Self.defaultWindow {
                    Text("Tap a bar · scroll · pinch").font(.system(size: 10)).foregroundStyle(Palette.muted(scheme))
                }
            }
            if points.allSatisfy({ $0.net == nil }) {
                Text("No energy balance data yet").font(.footnote).foregroundStyle(Palette.muted(scheme))
                    .frame(maxWidth: .infinity, minHeight: 60, alignment: .center)
            } else {
                HStack(spacing: 14) {
                    legendDot("Surplus", DashboardTheme.shared.positive)
                    legendDot("Deficit", DashboardTheme.shared.negative)
                    Spacer(minLength: 0)
                    // Reads out the tapped bar. Sits in the header rather than as a
                    // floating annotation so it can't be clipped by the plot area or
                    // cover the neighbouring bars.
                    if let selected = selectedPoint, let net = selected.net {
                        Text("\(Self.label(for: selected.date)) · \(Format.number(abs(net))) kcal \(net > 0 ? "surplus" : "deficit")")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(net > 0 ? DashboardTheme.shared.positive : DashboardTheme.shared.negative)
                            .lineLimit(1)
                    }
                }
                Chart {
                    RuleMark(y: .value("Zero", 0)).foregroundStyle(Palette.border(scheme))
                    ForEach(points, id: \.date) { point in
                        if let net = point.net {
                            BarMark(x: .value("Date", point.date), y: .value("kcal", net))
                                .foregroundStyle(net > 0 ? DashboardTheme.shared.positive : DashboardTheme.shared.negative)
                                // The tapped bar keeps full colour; the rest recede, so
                                // the selection reads without adding another element.
                                .opacity(selectedDate == nil || selectedDate == point.date ? 1 : 0.35)
                        }
                    }
                }
                .chartLegend(.hidden)
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 3)) { value in
                        AxisGridLine()
                        AxisTick()
                        AxisValueLabel {
                            if let iso = value.as(String.self) { Text(Self.label(for: iso)) }
                        }
                    }
                }
                .chartYAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
                // Same shape as the website's own horizontally-scrolled bar strip
                // (net-scroll, defaulting scrolled to today) — pinch adjusts how many
                // days are visible at once, matching the website's implicit zoom via
                // its own bar width.
                .chartScrollableAxes(.horizontal)
                .chartXVisibleDomain(length: max(3, Int((visibleCount / magnifyBy).rounded())))
                // initialX rather than a bound position set in onAppear/task: the
                // binding was applied before the scroll view had laid out and was
                // silently discarded, which is why this opened weeks in the past.
                .chartScrollPosition(initialX: initialScrollDate)
                // A plain tap that toggles, instead of chartXSelection's press-and-hold
                // (which also clears the moment you lift, so a reading never stayed up).
                .chartOverlay { proxy in
                    GeometryReader { geo in
                        Rectangle().fill(.clear).contentShape(Rectangle())
                            .onTapGesture { location in
                                guard let plot = proxy.plotFrame else { return }
                                let x = location.x - geo[plot].origin.x
                                guard let date: String = proxy.value(atX: x) else { return }
                                selectedDate = (selectedDate == date) ? nil : date
                            }
                    }
                }
                .simultaneousGesture(
                    MagnificationGesture()
                        .updating($magnifyBy) { value, state, _ in state = value }
                        .onEnded { value in
                            visibleCount = min(Double(points.count), max(3, visibleCount / value))
                        }
                )
                .frame(height: 130)
            }
        }
    }

    private func legendDot(_ label: String, _ color: Color) -> some View {
        HStack(spacing: 4) {
            Capsule().fill(color).frame(width: 14, height: 5)
            Text(label).font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
        }
    }
}

/// The website's EnergySummary: the box grid (2 columns, same 5-6 keys, the balance
/// box's label and colour flipping between Deficit/Surplus by sign) plus the two-track
/// segmented bar underneath it — burned (resting+active, stacked) above consumed, with
/// a hatched "gap" spanning the difference between them, labelled with the amount.
struct EnergySummaryBars: View {
    @Environment(\.colorScheme) private var scheme
    let summary: DaySummary?
    let rolling24h: Rolling24h?
    let boxes: [String]

    private var resting: Double { summary?.restingEnergy ?? 0 }
    private var active: Double { summary?.activeEnergy ?? 0 }
    private var total: Double { summary?.totalExpenditure ?? (resting + active) }
    private var consumed: Double { summary?.caloriesConsumed ?? 0 }
    private var balance: Double { total - consumed }
    private var balanceWord: String { balance >= 0 ? "Deficit" : "Surplus" }
    private var balanceAmount: Double { abs(balance) }
    private var maxVal: Double { max(total, max(consumed, 1)) }

    private struct BoxDef { var key: String; var color: Color; var label: String; var value: Double; var tinted: Bool }

    private var boxDefs: [BoxDef] {
        let theme = DashboardTheme.shared
        var defs = [
            BoxDef(key: "totalBurned", color: Palette.muted(scheme), label: "Total burned", value: total, tinted: false),
            BoxDef(key: "consumed", color: Palette.ink(scheme), label: "Consumed", value: consumed, tinted: false),
            BoxDef(key: "active", color: theme.secondary, label: "Active", value: active, tinted: false),
            BoxDef(key: "resting", color: theme.tertiary, label: "Resting", value: resting, tinted: false),
            BoxDef(key: "deficit", color: theme.primary, label: balanceWord, value: balanceAmount, tinted: true),
        ]
        if let r = rolling24h?.balance {
            let isDeficit = r < 0
            defs.append(BoxDef(key: "rolling24", color: theme.primary, label: "24h \(isDeficit ? "deficit" : "surplus")",
                               value: abs(r), tinted: true))
        }
        return defs.filter { boxes.contains($0.key) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !boxDefs.isEmpty {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(boxDefs, id: \.key) { def in
                        HStack(spacing: 0) {
                            VStack(alignment: .leading, spacing: 5) {
                                HStack(spacing: 6) {
                                    Circle().fill(def.color).frame(width: 7, height: 7)
                                    Text(def.label).font(.system(size: 12))
                                        .foregroundStyle(def.tinted ? DashboardTheme.shared.primary : Palette.muted(scheme))
                                }
                                Text("\(Format.number(def.value)) kcal")
                                    .font(.system(size: 19, weight: .semibold, design: .rounded))
                                    .foregroundStyle(def.tinted ? DashboardTheme.shared.primary : Palette.ink(scheme))
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(12)
                        .background(def.tinted ? DashboardTheme.shared.primary.opacity(0.1) : Palette.surface(scheme))
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(def.tinted ? DashboardTheme.shared.primary.opacity(0.35) : .clear, lineWidth: 1)
                        )
                    }
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                // Track 1: total burned, split into resting + active.
                GeometryReader { geo in
                    let w = geo.size.width
                    ZStack(alignment: .leading) {
                        Capsule().fill(Palette.surface(scheme))
                        HStack(spacing: 0) {
                            Rectangle().fill(DashboardTheme.shared.tertiary).frame(width: max(0, w * resting / maxVal))
                            Rectangle().fill(DashboardTheme.shared.secondary).frame(width: max(0, w * active / maxVal))
                        }
                        .clipShape(Capsule())
                    }
                }
                .frame(height: 14)

                // Track 2: consumed, plus a hatched gap spanning the difference.
                GeometryReader { geo in
                    let w = geo.size.width
                    let gapStart = min(total, consumed) / maxVal
                    let gapWidth = abs(total - consumed) / maxVal
                    ZStack(alignment: .leading) {
                        Capsule().fill(Palette.surface(scheme))
                        Rectangle().fill(Palette.ink(scheme)).frame(width: max(0, w * consumed / maxVal))
                            .clipShape(Capsule())
                        if balanceAmount > 0 {
                            ZStack {
                                DiagonalStripes(color: DashboardTheme.shared.primary)
                                if gapWidth > 0.16 {
                                    // Ink, not the accent: this sits on top of a hatched
                                    // fill in that same accent, so tinting it too left
                                    // the label barely legible against its own stripes.
                                    Text("\(Format.number(balanceAmount)) kcal \(balanceWord.lowercased())")
                                        .font(.system(size: 9, weight: .semibold))
                                        .foregroundStyle(Palette.ink(scheme))
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.6)
                                }
                            }
                            .frame(width: max(0, w * gapWidth), height: 14)
                            .clipShape(Capsule())
                            .offset(x: w * gapStart)
                        }
                    }
                }
                .frame(height: 14)
            }

            HStack(spacing: 14) {
                legendDot("Resting", DashboardTheme.shared.tertiary)
                legendDot("Active", DashboardTheme.shared.secondary)
                legendDot("Consumed", Palette.ink(scheme))
                legendDot("\(balanceWord) gap", DashboardTheme.shared.primary)
            }
        }
    }

    private func legendDot(_ label: String, _ color: Color) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(label).font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
        }
    }
}

/// A tiled diagonal-hatch fill, for the balance "gap" region — the same visual idea as
/// the website's repeating-gradient stripe, drawn natively since SwiftUI has no CSS
/// equivalent.
private struct DiagonalStripes: View {
    let color: Color

    var body: some View {
        Canvas { context, size in
            let spacing: CGFloat = 6
            var x = -size.height
            while x < size.width {
                var path = Path()
                path.move(to: CGPoint(x: x, y: size.height))
                path.addLine(to: CGPoint(x: x + size.height, y: 0))
                context.stroke(path, with: .color(color.opacity(0.6)), lineWidth: 2)
                x += spacing
            }
        }
        .background(color.opacity(0.16))
    }
}
