import SwiftUI

// The website's Recipes tab (public/recipes.html + recipes.js): the shared, global
// recipe bank — a recipe any account adds is visible to everyone signed into this
// Fuel server. Logging reads nutrition straight from the bank so what gets logged
// always matches the recipe; a recipe with no nutrition yet is estimated once via
// Fuel AI, then logged, mirroring the website's single-retry backfill-then-log flow.

struct RecipesView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme
    @State private var search = ""
    @State private var backfillBusy = false

    private var recipes: [Recipe] { store.dashboard?.recipes ?? [] }

    private var filtered: [Recipe] {
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !query.isEmpty else { return recipes }
        return recipes.filter { recipe in
            let haystack = ([recipe.name, recipe.category, recipe.serving] + (recipe.ingredients ?? []) + (recipe.instructions ?? []))
                .compactMap { $0 }.joined(separator: " ").lowercased()
            return haystack.contains(query)
        }
    }

    private var grouped: [(category: String, items: [Recipe])] {
        Dictionary(grouping: filtered) { $0.category ?? "Other recipes" }
            .sorted { $0.key < $1.key }
            .map { (category: $0.key, items: $0.value) }
    }

    private var pendingNutrition: [Recipe] { recipes.filter { $0.nutrition?.calories == nil } }

    var body: some View {
        List {
            if !pendingNutrition.isEmpty {
                Section {
                    HStack {
                        Text("\(pendingNutrition.count) recipe\(pendingNutrition.count == 1 ? "" : "s") \(pendingNutrition.count == 1 ? "has" : "have") no nutrition breakdown, so \(pendingNutrition.count == 1 ? "it cannot" : "they cannot") be logged yet.")
                            .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                        Spacer()
                        Button {
                            Task { backfillBusy = true; await store.fillPendingRecipeNutrition(); backfillBusy = false }
                        } label: {
                            if backfillBusy { ProgressView().controlSize(.small) } else { Text("Fill in with AI").font(.system(size: 12)) }
                        }
                        .buttonStyle(.bordered).controlSize(.small).disabled(backfillBusy)
                    }
                }
            }

            if recipes.isEmpty {
                Text("No saved recipes yet.").font(.footnote).foregroundStyle(Palette.muted(scheme))
            } else if filtered.isEmpty {
                Text("No recipes match that search.").font(.footnote).foregroundStyle(Palette.muted(scheme))
            } else {
                ForEach(grouped, id: \.category) { group in
                    Section(group.category) {
                        ForEach(group.items) { recipe in
                            NavigationLink { RecipeDetailView(recipe: recipe) } label: { RecipeRow(recipe: recipe) }
                        }
                    }
                }
            }
        }
        .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search recipes")
        .navigationTitle("Recipes")
        .task { if store.dashboard == nil { await store.load() } }
        .refreshable { await store.load() }
    }
}

private struct RecipeRow: View {
    @Environment(\.colorScheme) private var scheme
    let recipe: Recipe

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(recipe.name ?? "Untitled recipe").font(.system(size: 15, weight: .medium)).foregroundStyle(Palette.ink(scheme))
            Text(nutritionSummary).font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
        }
        .padding(.vertical, 2)
    }

    private var nutritionSummary: String {
        guard let n = recipe.nutrition, n.calories != nil else { return "Nutrition not entered" }
        var parts = ["\(Format.number(n.calories, decimals: 0)) kcal"]
        if let p = n.protein { parts.append("\(Format.number(p, decimals: 1))g protein") }
        if let c = n.carbs { parts.append("\(Format.number(c, decimals: 1))g carbs") }
        if let f = n.fat { parts.append("\(Format.number(f, decimals: 1))g fat") }
        return parts.joined(separator: " · ")
    }
}

struct RecipeDetailView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme
    let recipe: Recipe
    @State private var logging = false
    @State private var logStatus = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Panel {
                    Text(recipe.name ?? "Recipe").font(.system(size: 20, weight: .bold, design: .rounded)).foregroundStyle(Palette.ink(scheme))
                    if let serving = recipe.serving, !serving.isEmpty {
                        Text(serving).font(.system(size: 13)).foregroundStyle(Palette.muted(scheme))
                    }
                    if recipe.nutritionEstimated == true {
                        Text("Nutrition estimated by Fuel AI from the ingredients.")
                            .font(.system(size: 11)).italic().foregroundStyle(Palette.muted(scheme))
                    }
                    Button {
                        Task {
                            logging = true; logStatus = ""
                            let ok = await store.logRecipe(recipe)
                            logStatus = ok ? "Logged ✓" : "Could not log this recipe."
                            logging = false
                        }
                    } label: {
                        HStack {
                            if logging { ProgressView().controlSize(.small) } else { Image(systemName: "plus.circle.fill") }
                            Text(logging ? "Logging…" : (recipe.nutrition?.calories == nil ? "Estimate + log to today" : "Log to today"))
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(logging)
                    if !logStatus.isEmpty {
                        Text(logStatus).font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                    }
                }

                if let nutrition = recipe.nutrition, nutrition.calories != nil {
                    Panel(title: "Nutrition") {
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                            nutrientStat("Calories", nutrition.calories, "kcal", 0)
                            nutrientStat("Protein", nutrition.protein, "g", 1)
                            nutrientStat("Carbs", nutrition.carbs, "g", 1)
                            nutrientStat("Fat", nutrition.fat, "g", 1)
                            nutrientStat("Fiber", nutrition.fiber, "g", 1)
                        }
                    }
                }

                if let ingredients = recipe.ingredients, !ingredients.isEmpty {
                    Panel(title: "Ingredients") {
                        ForEach(ingredients, id: \.self) { item in
                            HStack(alignment: .top, spacing: 6) {
                                Text("•").foregroundStyle(Palette.muted(scheme))
                                Text(item).font(.system(size: 13)).foregroundStyle(Palette.ink(scheme))
                            }
                        }
                    }
                }

                if let instructions = recipe.instructions, !instructions.isEmpty {
                    Panel(title: "Instructions") {
                        ForEach(Array(instructions.enumerated()), id: \.offset) { index, step in
                            HStack(alignment: .top, spacing: 8) {
                                Text("\(index + 1).").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.muted(scheme))
                                Text(step).font(.system(size: 13)).foregroundStyle(Palette.ink(scheme))
                            }
                        }
                    }
                }

                if let source = recipe.source, !source.isEmpty {
                    Text("Source: \(source)").font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                }
            }
            .padding(16)
        }
        .background(Palette.background(scheme))
        .navigationTitle("Recipe")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func nutrientStat(_ label: String, _ value: Double?, _ unit: String, _ decimals: Int) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
            HStack(spacing: 3) {
                Text(Format.number(value, decimals: decimals)).font(.system(size: 16, weight: .semibold, design: .rounded))
                    .foregroundStyle(Palette.ink(scheme))
                Text(unit).font(.system(size: 10)).foregroundStyle(Palette.muted(scheme))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
