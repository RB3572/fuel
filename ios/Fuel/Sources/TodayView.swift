import SwiftUI
import Charts

// The website's dashboard, whole. Same eight sections in the same order, the same six
// energy boxes, the same 39-nutrient grid, the same metric cards — and the same edit
// controls: food entries, goals, past-day energy, and which sections show at all.
//
// The layout is server-backed, so reordering here reorders the website too. That is the
// point of replicating rather than reimagining: one dashboard, two windows onto it.

struct TodayView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme

    @State private var editingFood: FoodEntry?
    @State private var showGoals = false
    @State private var showHistory = false
    @State private var showLayout = false
    @State private var filling = false
    @State private var fillProgress = ""

    private var summary: DaySummary? { store.dashboard?.today.summary }
    private var goals: Goals? { store.dashboard?.goals }
    private var visible: [String] {
        store.layout.order.filter { !store.layout.hidden.contains($0) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    if let summary {
                        energyHero(summary)
                        ForEach(visible, id: \.self) { key in
                            section(key, summary)
                        }
                        coveragePanel
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
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { showGoals = true } label: { Label("Edit goals", systemImage: "target") }
                        Button { showHistory = true; Task { await store.loadHistory() } } label: {
                            Label("Edit past days", systemImage: "calendar")
                        }
                        Button { showLayout = true } label: { Label("Customise dashboard", systemImage: "square.grid.2x2") }
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
            .refreshable {
                await store.syncHealth(reason: "pull to refresh")
                await store.load()
            }
            .sheet(item: $editingFood) { EditFoodSheet(entry: $0) }
            .sheet(isPresented: $showGoals) { GoalsSheet() }
            .sheet(isPresented: $showHistory) { HistorySheet() }
            .sheet(isPresented: $showLayout) { LayoutSheet() }
        }
    }

    // MARK: Energy hero — the six boxes, each individually hideable

    @ViewBuilder
    private func energyHero(_ s: DaySummary) -> some View {
        let boxes = store.layout.energyBoxes
        Panel(title: "Energy", subtitle: s.partialDay == true ? "Today so far" : nil) {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                if boxes.contains("totalBurned") { Stat(label: "Total burned", value: Format.kcal(s.totalExpenditure)) }
                if boxes.contains("consumed") { Stat(label: "Consumed", value: Format.kcal(s.caloriesConsumed)) }
                if boxes.contains("active") { Stat(label: "Active", value: Format.kcal(s.activeEnergy)) }
                if boxes.contains("resting") { Stat(label: "Resting", value: Format.kcal(s.restingEnergy)) }
                if boxes.contains("deficit") {
                    Stat(label: "Balance", value: s.energyBalance == nil ? "—" : Format.kcal(s.energyBalance),
                         detail: s.partialDay == true ? "settles at midnight" : nil)
                }
                if boxes.contains("rolling24"), let rolling = store.dashboard?.rolling24h {
                    Stat(label: "Rolling 24h", value: Format.kcal(rolling.balance))
                }
            }
            if let intraday = store.dashboard?.intradayEnergy, !intraday.expenditure.isEmpty {
                intradayChart(intraday)
            }
            if let averages = store.dashboard?.energyAverages {
                Divider()
                HStack(alignment: .top, spacing: 8) {
                    Stat(label: "Avg burned", value: Format.kcal(averages.totalExpenditure))
                    Stat(label: "Avg resting", value: Format.kcal(averages.restingEnergy))
                    Stat(label: "Avg active", value: Format.kcal(averages.activeEnergy))
                }
            }
        }
    }

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
                    .foregroundStyle(Palette.muted(scheme)).interpolationMethod(.monotone)
            }
            ForEach(eaten, id: \.0) { point in
                LineMark(x: .value("Time", point.0), y: .value("kcal", point.1))
                    .foregroundStyle(Palette.flameMid).interpolationMethod(.stepEnd)
            }
        }
        .chartLegend(.hidden)
        .frame(height: 120)
    }

    // MARK: The eight sections

    @ViewBuilder
    private func section(_ key: String, _ s: DaySummary) -> some View {
        switch key {
        case "nutrition": nutritionSection(s)
        case "detailedNutrition": nutrientGrid(s)
        case "foodConsumed": foodSection
        case "fitness": metricSection("Fitness", [
            ("Active energy", s.activeEnergy, "kcal", 0),
            ("Exercise", s.exerciseMinutes, "min", 0),
            ("Walking + running", s.distanceMiles, "mi", 2),
            ("Running stride length", s.runningStrideLength, "m", 2),
        ])
        case "workouts": workoutsSection
        case "steps": metricSection("Steps & movement", [
            ("Steps", s.stepCount, "", 0),
            ("Stand time", s.standMinutes, "min", 0),
            ("Flights climbed", s.flightsClimbed, "flights", 0),
            ("Cycling distance", s.cyclingDistanceMiles, "mi", 2),
        ])
        case "vitals": metricSection("Vitals", [
            ("Resting heart rate", s.restingHeartRate, "bpm", 0),
            ("HRV", s.hrv, "ms", 0),
            ("Respiratory rate", s.respiratoryRate, "/min", 1),
            ("Blood oxygen", s.bloodOxygen, "%", 1),
            ("Walking heart rate", s.walkingHeartRateAverage, "bpm avg", 0),
            ("Cardio recovery", s.cardioRecovery, "bpm", 0),
            ("VO₂ max", s.vo2Max, "", 1),
        ])
        case "recovery": metricSection("Recovery", [
            ("Sleep", s.sleepHours, "h", 1),
            ("HRV", s.hrv, "ms", 0),
            ("Resting heart rate", s.restingHeartRate, "bpm", 0),
        ])
        default: EmptyView()
        }
    }

    private func nutritionSection(_ s: DaySummary) -> some View {
        Panel(title: "Nutrition") {
            GoalBar(label: "Calories", value: s.caloriesConsumed, target: goals?.calories?.target)
            GoalBar(label: "Protein", value: s.protein, target: goals?.protein?.target, unit: " g")
            GoalBar(label: "Carbohydrates", value: s.carbs, target: goals?.carbs?.target, unit: " g")
            GoalBar(label: "Fat", value: s.fat, target: goals?.fat?.target, unit: " g")
            GoalBar(label: "Fiber", value: s.fiber, target: goals?.fiber?.target, unit: " g")
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
                    .disabled(filling || !OnDeviceAI.shared.availability.isReady)
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
