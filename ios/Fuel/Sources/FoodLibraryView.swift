import SwiftUI

// One place to log something you have eaten before. Three tabs, in the order a person
// actually reaches for them:
//
//   History  — everything they have logged before, deduplicated, newest first.
//   Foods    — the built-in USDA table, grouped fruit/veggies/grains/protein/etc.
//   My meals — things they built and named.
//
// These used to be one long list with headings; that read fine with a handful of items
// each, but history and the common-foods table both run long, and scrolling past one to
// reach the other got tedious. Tabs let each shelf be exactly as long as it needs to be.

/// What the picker hands back. The caller decides whether to log it directly or drop it
/// into the manual form for editing.
enum FoodLibraryPick {
    case meal(SavedMeal)
    case history(FoodHistoryItem)
    case common(CommonFood)
}

private enum LibraryTab: String, CaseIterable {
    case history = "History"
    case foods = "Foods"
    case meals = "My meals"
}

struct FoodLibraryView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    var onPick: (FoodLibraryPick) -> Void

    @State private var tab: LibraryTab = .history
    @State private var search = ""
    @State private var composing = false
    @State private var mealPendingDeletion: SavedMeal?

    /// Browsing (no search) shows only the most recent handful — the point of this tab
    /// is "what did I just eat," not a full log. Searching lifts the cap: someone typing
    /// is looking for something specific and shouldn't be capped out of finding it.
    private static let historyBrowseLimit = 20

    private var query: String { search.trimmingCharacters(in: .whitespaces).lowercased() }

    private var meals: [SavedMeal] {
        guard !query.isEmpty else { return store.savedMeals }
        return store.savedMeals.filter {
            $0.name.lowercased().contains(query)
                || $0.items.contains { $0.description.lowercased().contains(query) }
        }
    }

    private var history: [FoodHistoryItem] {
        // Anything already saved as a meal is left out: the same food appearing twice,
        // once as a meal and once as history, reads as a duplicate rather than as two
        // ways in.
        let saved = Set(store.savedMeals.map { FoodHistoryItem.key($0.name) })
        var seen = Set<String>()
        let matches = store.foodHistory.filter {
            let key = FoodHistoryItem.key($0.description)
            guard !saved.contains(key), query.isEmpty || $0.description.lowercased().contains(query) else { return false }
            // Belt and braces on top of the server's own dedup: the app can be talking
            // to an older deployment, and a repeated row here is exactly the "it loads
            // some things twice" symptom.
            return seen.insert(key).inserted
        }
        return query.isEmpty ? Array(matches.prefix(Self.historyBrowseLimit)) : matches
    }

    private var common: [CommonFood] {
        guard !query.isEmpty else { return CommonFoods.all }
        return CommonFoods.all.filter { $0.name.lowercased().contains(query) }
    }

    private var searchPrompt: String {
        switch tab {
        case .history: return "Search your history"
        case .foods: return "Search foods"
        case .meals: return "Search your meals"
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // The tab bar sits on the same background as the list below it, with a
                // hairline between them — floating it on the default white left a seam
                // where the two backgrounds met and made the first section read as a
                // detached box.
                Picker("", selection: $tab) {
                    ForEach(LibraryTab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 10)
                .background(Palette.background(scheme))

                Divider()

                List {
                    if let libraryError = store.libraryError {
                        Section {
                            Label(libraryError, systemImage: "exclamationmark.triangle")
                                .font(.footnote).foregroundStyle(.orange)
                        }
                    }
                    switch tab {
                    case .history: historyTab
                    case .foods: foodsTab
                    case .meals: mealsTab
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(Palette.background(scheme))
            }
            .background(Palette.background(scheme))
            .searchable(text: $search, prompt: searchPrompt)
            .navigationTitle("Log something")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task { await store.loadLibrary() }
            .refreshable { await store.loadLibrary() }
            .sheet(isPresented: $composing) { MealComposerView() }
            .confirmationDialog("Delete this meal?", isPresented: Binding(
                get: { mealPendingDeletion != nil },
                set: { if !$0 { mealPendingDeletion = nil } }
            ), presenting: mealPendingDeletion) { meal in
                Button("Delete \(meal.name)", role: .destructive) {
                    Task { await store.deleteSavedMeal(meal) }
                }
            } message: { _ in
                Text("Entries you already logged from it stay in your diary.")
            }
        }
    }

    @ViewBuilder
    private var historyTab: some View {
        if history.isEmpty {
            // "Still loading" and "you have nothing" look identical as a blank list, and
            // telling them apart is exactly what was missing while the history route was
            // silently failing.
            if store.libraryLoading {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Loading your history…").font(.footnote).foregroundStyle(Palette.muted(scheme))
                }
            } else {
                emptyState
            }
        } else {
            Section {
                ForEach(history) { item in
                    Button { onPick(.history(item)) } label: { historyRow(item) }
                        .buttonStyle(.plain)
                }
            } header: {
                if query.isEmpty { Text("Most recently logged") }
            }
        }
    }

    @ViewBuilder
    private var foodsTab: some View {
        if common.isEmpty {
            emptyState
        } else {
            ForEach(CommonFoods.groups, id: \.self) { group in
                let items = common.filter { $0.group == group }
                if !items.isEmpty {
                    Section(group) {
                        ForEach(items) { item in
                            Button { onPick(.common(item)) } label: { commonRow(item) }
                                .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var mealsTab: some View {
        Section {
            Button { composing = true } label: {
                Label("Build a new meal", systemImage: "plus.circle.fill")
                    .font(.system(size: 15, weight: .medium))
            }
        }
        if meals.isEmpty {
            if !query.isEmpty { emptyState }
        } else {
            Section("My meals") {
                ForEach(meals) { meal in
                    Button { onPick(.meal(meal)) } label: { mealRow(meal) }
                        .buttonStyle(.plain)
                        .swipeActions {
                            Button(role: .destructive) { mealPendingDeletion = meal } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                }
            }
        }
    }

    private var emptyState: some View {
        Text(query.isEmpty ? "Nothing here yet." : "Nothing matches “\(search)”.")
            .font(.footnote).foregroundStyle(Palette.muted(scheme))
    }

    private func mealRow(_ meal: SavedMeal) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(meal.name).foregroundStyle(Palette.ink(scheme))
                Text(meal.items.count == 1
                     ? (meal.items.first?.portion ?? "1 item")
                     : "\(meal.items.count) items")
                    .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
            }
            Spacer()
            macroColumn(calories: meal.nutrition?.calories, protein: meal.nutrition?.protein,
                        carbs: meal.nutrition?.carbs, fat: meal.nutrition?.fat)
        }
    }

    private func historyRow(_ item: FoodHistoryItem) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.description).foregroundStyle(Palette.ink(scheme)).lineLimit(2)
                if let portion = item.portion, !portion.isEmpty {
                    Text(portion).font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                }
            }
            Spacer()
            macroColumn(calories: item.calories, protein: item.protein, carbs: item.carbs, fat: item.fat)
        }
    }

    private func commonRow(_ item: CommonFood) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(item.name).foregroundStyle(Palette.ink(scheme))
                Text(item.portion).font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
            }
            Spacer()
            macroColumn(calories: item.calories, protein: item.protein, carbs: item.carbs, fat: item.fat)
        }
    }

    private func macroColumn(calories: Double?, protein: Double?, carbs: Double?, fat: Double?) -> some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(Format.kcal(calories)).font(.system(size: 14, weight: .medium))
                .foregroundStyle(Palette.ink(scheme))
            Text("P \(Format.number(protein)) · C \(Format.number(carbs)) · F \(Format.number(fat))")
                .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
        }
    }
}

/// Building a meal by hand, item by item. The alternative — only ever creating meals out
/// of things already logged — would mean you could not set up your usual breakfast until
/// the morning you happened to log every part of it separately.
struct MealComposerView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme

    @State private var name = ""
    @State private var mealKind = "breakfast"
    @State private var items: [SavedMeal.Item] = []
    @State private var adding = false
    @State private var saving = false

    private let meals = ["breakfast", "lunch", "dinner", "snack"]

    private var totals: (Double, Double, Double, Double) {
        items.reduce(into: (0.0, 0.0, 0.0, 0.0)) { sum, item in
            sum.0 += item.calories ?? 0
            sum.1 += item.protein ?? 0
            sum.2 += item.carbs ?? 0
            sum.3 += item.fat ?? 0
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Meal") {
                    TextField("e.g. usual breakfast", text: $name)
                    Picker("Usually", selection: $mealKind) {
                        ForEach(meals, id: \.self) { Text($0.capitalized).tag($0) }
                    }
                }

                Section {
                    ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.description)
                                if let portion = item.portion, !portion.isEmpty {
                                    Text(portion).font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                                }
                            }
                            Spacer()
                            Text(Format.kcal(item.calories)).font(.system(size: 13))
                                .foregroundStyle(Palette.muted(scheme))
                        }
                    }
                    .onDelete { items.remove(atOffsets: $0) }

                    Button { adding = true } label: { Label("Add an item", systemImage: "plus") }
                } header: {
                    Text("Items")
                } footer: {
                    if !items.isEmpty {
                        let totals = totals
                        Text("\(Format.kcal(totals.0)) kcal · P \(Format.number(totals.1)) · C \(Format.number(totals.2)) · F \(Format.number(totals.3))")
                    }
                }
            }
            .navigationTitle("New meal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        saving = true
                        Task {
                            let ok = await store.saveMeal(named: name, meal: mealKind, items: items)
                            saving = false
                            if ok { dismiss() }
                        }
                    }
                    .disabled(saving || name.trimmingCharacters(in: .whitespaces).isEmpty || items.isEmpty)
                }
            }
            .sheet(isPresented: $adding) {
                MealItemEditor { items.append($0) }
            }
        }
    }
}

/// One item of a meal being built. Suggests from what you've actually logged before,
/// ahead of the built-in common-foods table — a saved meal is meant to be your own
/// usual order, and your own history is a better guess at that than a reference table.
struct MealItemEditor: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    var onAdd: (SavedMeal.Item) -> Void

    @State private var description = ""
    @State private var portion = ""
    @State private var calories = ""
    @State private var protein = ""
    @State private var carbs = ""
    @State private var fat = ""
    @State private var fiber = ""

    private var query: String { description.trimmingCharacters(in: .whitespaces).lowercased() }

    private var historyMatches: [FoodHistoryItem] {
        guard query.count >= 2 else { return [] }
        var seen = Set<String>()
        return Array(store.foodHistory
            .filter { $0.description.lowercased().contains(query) && seen.insert(FoodHistoryItem.key($0.description)).inserted }
            .prefix(4))
    }

    /// The built-in table minus anything the history shelf above is already offering.
    /// Both lists render one after the other, so a food in both — now that history
    /// actually loads — appeared twice in a row, with two different sets of numbers.
    private var commonMatches: [CommonFood] {
        let alreadyOffered = Set(historyMatches.map { FoodHistoryItem.key($0.description) })
        return CommonFoods.matches(description, limit: 4)
            .filter { !alreadyOffered.contains(FoodHistoryItem.key($0.name)) }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("What") {
                    TextField("e.g. greek yogurt", text: $description)
                    TextField("Portion (optional)", text: $portion)
                    ForEach(historyMatches) { hit in
                        Button {
                            description = hit.description
                            if portion.isEmpty { portion = hit.portion ?? "" }
                            calories = Format.number(hit.calories)
                            protein = Format.number(hit.protein)
                            carbs = Format.number(hit.carbs)
                            fat = Format.number(hit.fat)
                            fiber = Format.number(hit.fiber)
                        } label: {
                            HStack {
                                Image(systemName: "clock.arrow.circlepath")
                                    .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                                Text(hit.description).font(.system(size: 14))
                                Spacer()
                                Text(Format.kcal(hit.calories)).font(.system(size: 12))
                                    .foregroundStyle(Palette.muted(scheme))
                            }
                        }
                        .foregroundStyle(Palette.ink(scheme))
                    }
                    ForEach(commonMatches) { hit in
                        Button {
                            description = hit.name
                            if portion.isEmpty { portion = hit.portion }
                            calories = Format.number(hit.calories)
                            protein = Format.number(hit.protein)
                            carbs = Format.number(hit.carbs)
                            fat = Format.number(hit.fat)
                            fiber = Format.number(hit.fiber)
                        } label: {
                            HStack {
                                Text(hit.name).font(.system(size: 14))
                                Spacer()
                                Text(Format.kcal(hit.calories)).font(.system(size: 12))
                                    .foregroundStyle(Palette.muted(scheme))
                            }
                        }
                    }
                }
                Section("Nutrition") {
                    field("Calories", "kcal", $calories)
                    field("Protein", "g", $protein)
                    field("Carbs", "g", $carbs)
                    field("Fat", "g", $fat)
                    field("Fiber", "g", $fiber)
                }
            }
            .navigationTitle("Add item")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        onAdd(SavedMeal.Item(
                            description: description.trimmingCharacters(in: .whitespaces),
                            portion: portion.isEmpty ? nil : portion,
                            calories: Double(calories), protein: Double(protein),
                            carbs: Double(carbs), fat: Double(fat), fiber: Double(fiber)))
                        dismiss()
                    }
                    .disabled(description.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func field(_ label: String, _ unit: String, _ value: Binding<String>) -> some View {
        HStack {
            Text(label)
            Spacer()
            TextField("—", text: value)
                .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 84)
            Text(unit).font(.system(size: 13)).foregroundStyle(Palette.muted(scheme))
                .frame(width: 28, alignment: .leading)
        }
    }
}
