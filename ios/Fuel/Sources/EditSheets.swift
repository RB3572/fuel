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
                    } label: { Label("Re-estimate with on-device AI", systemImage: "sparkles") }
                    .disabled(saving || food.isEmpty || !OnDeviceAI.shared.availability.isReady)
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
                            await store.saveGoals(next)
                            saving = false
                            dismiss()
                        }
                    }
                    .disabled(saving)
                }
            }
            .onAppear {
                let g = store.goalValues
                values = [
                    "calorieBalancePercent": text(g.calorieBalancePercent), "protein": text(g.protein),
                    "carbs": text(g.carbs), "fat": text(g.fat), "fiber": text(g.fiber),
                    "move": text(g.move), "exercise": text(g.exercise), "stand": text(g.stand),
                    "steps": text(g.steps), "sleepHours": text(g.sleepHours),
                ]
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

// MARK: - Which sections show, and in what order

struct LayoutSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var layout = DashboardLayout.default

    private static let names = [
        "nutrition": "Nutrition", "detailedNutrition": "Detailed nutrition",
        "foodConsumed": "Food consumed", "fitness": "Fitness", "workouts": "Workouts",
        "steps": "Steps & movement", "vitals": "Vitals", "recovery": "Recovery",
    ]
    private static let boxNames = [
        "totalBurned": "Total burned", "consumed": "Consumed", "active": "Active",
        "resting": "Resting", "deficit": "Balance", "rolling24": "Rolling 24h",
    ]

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(layout.order, id: \.self) { key in
                        HStack {
                            Text(Self.names[key] ?? key)
                            Spacer()
                            Button {
                                if layout.hidden.contains(key) { layout.hidden.removeAll { $0 == key } }
                                else { layout.hidden.append(key) }
                            } label: {
                                Image(systemName: layout.hidden.contains(key) ? "eye.slash" : "eye")
                                    .foregroundStyle(layout.hidden.contains(key) ? .secondary : Color.accentColor)
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                    .onMove { from, to in layout.order.move(fromOffsets: from, toOffset: to) }
                } header: {
                    Text("Sections")
                } footer: {
                    // Reordering and tapping have to be separate modes: a List in edit
                    // mode swallows taps on the controls inside its rows, so an
                    // always-on edit mode leaves the eye looking tappable and dead.
                    Text("Tap the eye to hide a section. Tap Reorder to drag them into a new order. This is the same layout the website uses.")
                }

                Section("Energy boxes") {
                    ForEach(DashboardLayout.allEnergyBoxes, id: \.self) { key in
                        Toggle(Self.boxNames[key] ?? key, isOn: Binding(
                            get: { layout.energyBoxes.contains(key) },
                            set: { on in
                                if on { if !layout.energyBoxes.contains(key) { layout.energyBoxes.append(key) } }
                                else { layout.energyBoxes.removeAll { $0 == key } }
                            }
                        ))
                    }
                }
            }
            .navigationTitle("Customise")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) { EditButton() }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await store.saveLayout(layout); dismiss() } }
                }
            }
            .onAppear { layout = store.layout }
        }
    }
}
