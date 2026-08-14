import SwiftUI

// The website's edit controls, as sheets. Every one writes through the same endpoint the
// browser uses, so a change made on the phone is the change the browser sees.

// MARK: - Edit a food entry

struct EditFoodSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    let entry: FoodEntry
    @State private var food = ""
    @State private var meal = ""
    @State private var portion = ""
    @State private var calories = ""
    @State private var protein = ""
    @State private var carbs = ""
    @State private var fat = ""
    @State private var fiber = ""
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section("What") {
                    TextField("Food", text: $food, axis: .vertical)
                    TextField("Meal", text: $meal)
                    TextField("Portion", text: $portion)
                }
                Section("Nutrition") {
                    numberField("Calories", $calories, unit: "kcal")
                    numberField("Protein", $protein, unit: "g")
                    numberField("Carbohydrates", $carbs, unit: "g")
                    numberField("Fat", $fat, unit: "g")
                    numberField("Fiber", $fiber, unit: "g")
                }
                Section {
                    Button {
                        Task {
                            saving = true
                            // Re-estimating overwrites only the numbers, never the text.
                            if let estimate = try? await OnDeviceAI.shared.estimateNutrition(
                                food: food, portion: portion.isEmpty ? nil : portion) {
                                calories = text(estimate.calories); protein = text(estimate.protein)
                                carbs = text(estimate.carbs); fat = text(estimate.fat); fiber = text(estimate.fiber)
                            }
                            saving = false
                        }
                    } label: {
                        Label(APIKeyStore.shared.activeProvider.map { "Re-estimate with \($0.label)" }
                              ?? "Re-estimate with on-device AI", systemImage: "sparkles")
                    }
                    .disabled(saving || food.isEmpty || !OnDeviceAI.shared.isUsable)
                }
            }
            .navigationTitle("Edit entry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            saving = true
                            await store.updateFood(entry, description: food,
                                                   meal: meal.isEmpty ? nil : meal,
                                                   portion: portion.isEmpty ? nil : portion,
                                                   calories: Double(calories), protein: Double(protein),
                                                   carbs: Double(carbs), fat: Double(fat), fiber: Double(fiber))
                            saving = false
                            dismiss()
                        }
                    }
                    .disabled(saving || food.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .onAppear {
                food = entry.food ?? ""; meal = entry.meal ?? ""; portion = entry.portion ?? ""
                calories = text(entry.calories); protein = text(entry.protein)
                carbs = text(entry.carbs); fat = text(entry.fat); fiber = text(entry.fiber)
            }
        }
    }

    private func numberField(_ label: String, _ binding: Binding<String>, unit: String) -> some View {
        HStack {
            Text(label)
            Spacer()
            TextField("—", text: binding)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 90)
            Text(unit).font(.caption).foregroundStyle(Palette.muted(scheme))
        }
    }

    private func text(_ value: Double?) -> String {
        guard let value else { return "" }
        return value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
    }
}

// MARK: - Goals

struct GoalsSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var values: [String: String] = [:]
    @State private var saving = false
    @State private var loading = true

    /// The website's editable goal keys, in its order. Calories are derived from the
    /// balance percentage there, so they are shown but not edited here either.
    private let fields: [(String, String, String)] = [
        ("calorieBalancePercent", "Calorie balance", "%"),
        ("protein", "Protein", "g"),
        ("carbs", "Carbohydrates", "g"),
        ("fat", "Fat", "g"),
        ("fiber", "Fiber", "g"),
        ("move", "Move", "kcal"),
        ("exercise", "Exercise", "min"),
        ("stand", "Stand", "min"),
        ("steps", "Steps", ""),
        ("sleepHours", "Sleep", "h"),
    ]

    var body: some View {
        NavigationStack {
            Form {
                if loading {
                    HStack {
                        Spacer()
                        ProgressView().padding(.vertical, 20)
                        Spacer()
                    }
                }
                Section {
                    ForEach(fields, id: \.0) { key, label, unit in
                        HStack {
                            Text(label)
                            Spacer()
                            TextField("—", text: Binding(
                                get: { values[key] ?? "" },
                                set: { values[key] = $0 }
                            ))
                            .keyboardType(.numbersAndPunctuation)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 90)
                            if !unit.isEmpty { Text(unit).font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                } footer: {
                    Text("Calorie balance sets your daily target as a percentage of what you burn: 0 is maintenance, negative is a deficit.")
                }
                Section {
                    HStack {
                        Text("Resting floor")
                        Spacer()
                        TextField("0", text: Binding(
                            get: { values["restingCaloriesFloor"] ?? "" },
                            set: { values["restingCaloriesFloor"] = $0 }
                        ))
                        .keyboardType(.numbersAndPunctuation)
                        .multilineTextAlignment(.trailing)
                        .frame(width: 90)
                        Text("kcal").font(.caption).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Minimum resting calories")
                } footer: {
                    Text("If a day's synced resting calories end up below this once the day is over, Fuel bumps that day's resting (and total) calories up to this floor so it doesn't understate that day's burn. 0 turns it off.")
                }
            }
            .navigationTitle("Goals")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            saving = true
                            var next = store.goalValues
                            next.calorieBalancePercent = Double(values["calorieBalancePercent"] ?? "")
                            next.protein = Double(values["protein"] ?? "")
                            next.carbs = Double(values["carbs"] ?? "")
                            next.fat = Double(values["fat"] ?? "")
                            next.fiber = Double(values["fiber"] ?? "")
                            next.move = Double(values["move"] ?? "")
                            next.exercise = Double(values["exercise"] ?? "")
                            next.stand = Double(values["stand"] ?? "")
                            next.steps = Double(values["steps"] ?? "")
                            next.sleepHours = Double(values["sleepHours"] ?? "")
                            next.restingCaloriesFloor = Double(values["restingCaloriesFloor"] ?? "")
                            await store.saveGoals(next)
                            saving = false
                            dismiss()
                        }
                    }
                    .disabled(saving || loading)
                }
            }
            .task {
                // Always re-fetches rather than trusting the app-launch-time cache, so
                // a slow or failed initial load never leaves this sheet showing blanks.
                await store.loadGoals()
                let g = store.goalValues
                values = [
                    "calorieBalancePercent": text(g.calorieBalancePercent), "protein": text(g.protein),
                    "carbs": text(g.carbs), "fat": text(g.fat), "fiber": text(g.fiber),
                    "move": text(g.move), "exercise": text(g.exercise), "stand": text(g.stand),
                    "steps": text(g.steps), "sleepHours": text(g.sleepHours),
                    "restingCaloriesFloor": text(g.restingCaloriesFloor),
                ]
                loading = false
            }
        }
    }

    private func text(_ value: Double?) -> String {
        guard let value else { return "" }
        return value == value.rounded() ? String(Int(value)) : String(format: "%.1f", value)
    }
}

// MARK: - Past days

struct HistorySheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    @State private var editing: String?
    @State private var burned = ""
    @State private var resting = ""
    @State private var active = ""
    @State private var consumed = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(store.history) { day in
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text(day.date).font(.system(size: 15, weight: .medium))
                                if day.consumedOverridden == true {
                                    Text("overridden").font(.caption2)
                                        .padding(.horizontal, 6).padding(.vertical, 2)
                                        .background(Palette.surface(scheme), in: Capsule())
                                }
                                Spacer()
                                Button(editing == day.date ? "Close" : "Edit") {
                                    if editing == day.date { editing = nil } else { begin(day) }
                                }
                                .font(.caption)
                            }
                            if editing == day.date {
                                field("Total burned", $burned)
                                field("Resting", $resting)
                                field("Active", $active)
                                field("Consumed", $consumed)
                                Button("Save day") {
                                    Task {
                                        await store.saveHistory(date: day.date,
                                                                totalExpenditure: Double(burned),
                                                                restingEnergy: Double(resting),
                                                                activeEnergy: Double(active),
                                                                consumed: Double(consumed))
                                        editing = nil
                                    }
                                }
                                .buttonStyle(.borderedProminent).controlSize(.small)
                            } else {
                                Text([
                                    day.totalExpenditure.map { "burned \(Int($0))" },
                                    day.consumed.map { "ate \(Int($0))" },
                                ].compactMap { $0 }.joined(separator: " · "))
                                    .font(.caption).foregroundStyle(Palette.muted(scheme))
                            }
                        }
                        .padding(.vertical, 4)
                    }
                } footer: {
                    Text("Editing a day overrides its energy and intake without touching that day's food entries. Clear a box to remove the override.")
                }
            }
            .navigationTitle("Past days")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task { await store.loadHistory() }
        }
    }

    private func begin(_ day: HistoryDay) {
        editing = day.date
        burned = text(day.totalExpenditure); resting = text(day.restingEnergy)
        active = text(day.activeEnergy); consumed = text(day.consumed)
    }

    private func field(_ label: String, _ binding: Binding<String>) -> some View {
        HStack {
            Text(label).font(.caption)
            Spacer()
            TextField("—", text: binding)
                .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 90)
        }
    }

    private func text(_ value: Double?) -> String {
        guard let value else { return "" }
        return String(Int(value))
    }
}

// MARK: - Preferences & context

/// Food preferences, allergies, activity, goals — durable free-text guidance the Coach
/// reads on every question, and that MCP clients can read and append to. Editing here
/// replaces the complete stored context, exactly as the website's version does.
struct ContextEditorSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var text = ""
    @State private var saving = false
    @State private var loaded = false
    @State private var learning = false
    @State private var learnError: String?

    // The slowly-changing facts, kept out of the free-text box on purpose: they are
    // answered once and then left alone, they are read by the comparison tables rather
    // than by the Coach's prose, and a number buried in a paragraph cannot be used to
    // pick an age band.
    @State private var heightIn = ""
    @State private var weightLb = ""
    @State private var age = ""
    @State private var sex = ""

    private static let limit = 20000

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    numberRow("Height", unit: "in", text: $heightIn)
                    numberRow("Weight", unit: "lb", text: $weightLb)
                    numberRow("Age", unit: "years", text: $age)
                    Picker("Sex", selection: $sex) {
                        Text("Not set").tag("")
                        Text("Male").tag("m")
                        Text("Female").tag("f")
                    }
                } header: {
                    Text("About you")
                } footer: {
                    Text("Set once and forget. These pick the reference group on Compare — published norms are split by age and sex, so without them the comparison is against everybody rather than against people like you.")
                }

                Section {
                    TextEditor(text: $text)
                        .frame(minHeight: 220)
                        .disabled(!loaded)
                        .onChange(of: text) { _, value in
                            if value.count > Self.limit { text = String(value.prefix(Self.limit)) }
                        }
                } footer: {
                    Text("\(text.count) / \(Self.limit) characters. MCP clients can read this field and append newly learned preferences. Saving here replaces the complete stored context.")
                }
                Section {
                    Button {
                        Task {
                            learning = true; learnError = nil
                            do {
                                let bullets = try await store.learnFromMe()
                                appendLearned(bullets)
                            } catch {
                                learnError = "Couldn't learn anything just now — try again in a bit."
                            }
                            learning = false
                        }
                    } label: {
                        HStack(spacing: 6) {
                            if learning { ProgressView().controlSize(.small) } else { Image(systemName: "sparkles") }
                            Text(learning ? "Looking at what you've logged…" : "Learn from me")
                        }
                    }
                    .disabled(learning || !loaded)
                    if let learnError {
                        Text(learnError).font(.footnote).foregroundStyle(.orange)
                    }
                } footer: {
                    Text("Looks at your logged routines, places, food and workouts and adds what it notices below — it only ever adds to what's here, never removes or rewrites anything. Review it and tap Save when you're happy.")
                }
            }
            .navigationTitle("Preferences & context")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            saving = true
                            // Two stores behind one button: the free text is its own
                            // field, the numbers ride on the goals row.
                            await store.saveContext(text)
                            await saveProfile()
                            saving = false
                            dismiss()
                        }
                    }
                    .disabled(saving || !loaded)
                }
            }
            .task {
                if store.context.isEmpty { await store.loadContext() }
                if store.goalValues.calories == nil { await store.loadGoals() }
                text = store.context
                loadProfile()
                loaded = true
            }
        }
    }

    /// Appends, never replaces — a fresh header each time so repeated runs don't blur
    /// together, and every existing line stays exactly where it was.
    private func appendLearned(_ bullets: [String]) {
        guard !bullets.isEmpty else { return }
        let header = "— Learned from your data, \(Self.dateStamp()) —"
        let block = ([header] + bullets.map { "- \($0)" }).joined(separator: "\n")
        text = text.isEmpty ? block : text + "\n\n" + block
        if text.count > Self.limit { text = String(text.prefix(Self.limit)) }
    }

    private func numberRow(_ label: String, unit: String, text: Binding<String>) -> some View {
        HStack {
            Text(label)
            Spacer()
            TextField("—", text: text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 90)
            Text(unit).font(.system(size: 13)).foregroundStyle(.secondary)
                .frame(width: 42, alignment: .leading)
        }
    }

    /// Saved on the same PUT the goals use — see GoalValues, whose profile half these
    /// fill in — so there is one write path rather than two that can disagree.
    private func saveProfile() async {
        var next = store.goalValues
        next.heightIn = Double(heightIn)
        next.weightLb = Double(weightLb)
        next.age = Int(age)
        next.sex = sex.isEmpty ? nil : sex
        await store.saveGoals(next)
    }

    private func loadProfile() {
        let profile = store.dashboard?.goalProfile
        if heightIn.isEmpty, let value = profile?.heightIn { heightIn = String(format: "%g", value.rounded()) }
        if weightLb.isEmpty, let value = profile?.weightLb { weightLb = String(format: "%g", value.rounded()) }
        if age.isEmpty, let value = profile?.age { age = String(value) }
        if sex.isEmpty { sex = profile?.sex ?? "" }
    }

    private static func dateStamp() -> String {
        let f = DateFormatter()
        f.dateStyle = .medium
        return f.string(from: Date())
    }
}
