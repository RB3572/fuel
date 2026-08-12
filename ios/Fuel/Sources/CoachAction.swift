import Foundation
import FoundationModels

// Lets the Coach *do* things, not just answer questions: fix a mis-logged meal, correct
// yesterday's calories, move a goal, add a recipe, flip a setting.
//
// The model never touches the app directly. It emits one of these structured actions,
// the app renders it as a confirmation card, and only an explicit tap executes it. That
// ordering is the whole safety design — a wrong number in a nutrition log is easy for a
// model to produce and annoying for a person to discover later, so nothing mutates on
// the strength of a parse alone.
//
// Structured extraction rather than each provider's native tool-calling: the same
// @Generable type drives the on-device model under constrained decoding and every
// bring-your-own-key provider through plain JSON mode. One shape, one executor, one set
// of tests — instead of four tool-call protocols that can drift apart.

@Generable
struct CoachAction: Codable, Equatable {
    @Guide(description: """
    What the person is asking for, exactly one of: none, logFood, updateFood, deleteFood, \
    editDay, setGoals, addRecipe, setSetting, updateContext. Use none when they are asking \
    a question rather than asking you to change something.
    """)
    var kind: String

    @Guide(description: "One short sentence naming the change, e.g. 'Set your protein goal to 160 g'. Empty when kind is none.")
    var summary: String

    // Food — logFood, updateFood, deleteFood
    @Guide(description: "The food description, e.g. 'chicken burrito bowl'. For updateFood/deleteFood this names the existing entry to change.")
    var food: String?
    @Guide(description: "New food description when renaming an entry; otherwise empty.")
    var newFood: String?
    @Guide(description: "One of: breakfast, lunch, dinner, snack.")
    var meal: String?
    var portion: String?
    var calories: Double?
    var protein: Double?
    var carbs: Double?
    var fat: Double?
    var fiber: Double?

    // editDay — correcting a past day's energy
    @Guide(description: "The day to edit as YYYY-MM-DD. 'yesterday' must be resolved to a real date.")
    var date: String?
    var totalExpenditure: Double?
    var restingEnergy: Double?
    var activeEnergy: Double?
    @Guide(description: "Total calories eaten that day, when correcting intake.")
    var consumed: Double?

    // setGoals — only the goals actually mentioned are set
    var calorieBalancePercent: Double?
    var proteinGoal: Double?
    var carbsGoal: Double?
    var fatGoal: Double?
    var fiberGoal: Double?
    var stepsGoal: Double?
    var sleepHoursGoal: Double?

    // addRecipe
    var recipeName: String?
    @Guide(description: "Ingredients, one per line.")
    var ingredients: String?
    var servings: Double?

    // setSetting
    @Guide(description: """
    Which setting to change, one of: darkMode, backgroundSync, syncQuantitySamples, \
    syncCategorySamples, syncWorkouts, syncWorkoutRoutes, palette.
    """)
    var setting: String?
    var enabled: Bool?
    @Guide(description: "Palette name when setting is palette: Website, Flame, Ocean, Forest, Berry or Slate.")
    var paletteName: String?

    // updateContext
    @Guide(description: "Text to add to the person's stored preferences, e.g. 'Vegetarian. Allergic to peanuts.'")
    var contextAddition: String?

    static let none = CoachAction(kind: "none", summary: "")

    var isActionable: Bool { kind != "none" && !kind.isEmpty && !summary.isEmpty }
}

/// Turns a confirmed action into the AppStore calls that already back the manual UI, so
/// the Coach path and the tap-through path cannot diverge in behaviour.
@MainActor
enum CoachActions {
    /// Every kind the executor understands. `interpret` is told this list, and anything
    /// outside it is refused rather than silently ignored.
    static let kinds = ["logFood", "updateFood", "deleteFood", "editDay",
                        "setGoals", "addRecipe", "setSetting", "updateContext"]

    struct Result { var ok: Bool; var message: String }

    /// A cheap local gate before spending a model call on interpretation. "How am I
    /// doing?" is the overwhelmingly common message and can never be an action, so
    /// running the interpreter on it would double the latency of every question and,
    /// on a bring-your-own-key provider, its cost too.
    ///
    /// Deliberately generous: a false positive costs one extra call that returns "none",
    /// while a false negative would make a real instruction silently do nothing. The
    /// model is still the thing that decides — this only decides whether to ask it.
    static func looksLikeCommand(_ message: String) -> Bool {
        let text = message.lowercased()
        // A leading question word is the one strong signal that nothing is being asked
        // for — but "can you set…" and "what should I set my goal to" are requests, so
        // only bail when no imperative appears anywhere.
        let verbs = ["set ", "change ", "update ", "add ", "log ", "delete ", "remove ",
                     "fix ", "correct ", "rename ", "edit ", "turn on", "turn off",
                     "switch to", "make it", "make my", "record ", "save ", "enable ", "disable "]
        return verbs.contains { text.contains($0) }
    }

    static func execute(_ action: CoachAction, store: AppStore) async -> Result {
        switch action.kind {
        case "logFood":
            guard let food = action.food, !food.isEmpty else { return .init(ok: false, message: "I didn't catch what to log.") }
            let nutrition = EstimatedNutrition(calories: action.calories, protein: action.protein,
                                               carbs: action.carbs, fat: action.fat, fiber: action.fiber)
            let hasNumbers = [action.calories, action.protein, action.carbs, action.fat, action.fiber].contains { $0 != nil }
            await store.logFood(description: food, meal: action.meal, portion: action.portion,
                                nutrition: hasNumbers ? nutrition : nil)
            return .init(ok: true, message: "Logged \(food).")

        case "updateFood":
            guard let target = matchEntry(action.food, in: store) else {
                return .init(ok: false, message: "I couldn't find that entry in today's log.")
            }
            await store.updateFood(target,
                                   description: action.newFood ?? target.food ?? "",
                                   meal: action.meal ?? target.meal,
                                   portion: action.portion ?? target.portion,
                                   calories: action.calories ?? target.calories,
                                   protein: action.protein ?? target.protein,
                                   carbs: action.carbs ?? target.carbs,
                                   fat: action.fat ?? target.fat,
                                   fiber: action.fiber ?? target.fiber)
            return .init(ok: true, message: "Updated \(target.food ?? "that entry").")

        case "deleteFood":
            guard let target = matchEntry(action.food, in: store) else {
                return .init(ok: false, message: "I couldn't find that entry in today's log.")
            }
            await store.deleteFood(target)
            return .init(ok: true, message: "Deleted \(target.food ?? "that entry").")

        case "editDay":
            guard let date = action.date, !date.isEmpty else { return .init(ok: false, message: "I need a date to edit.") }
            await store.saveHistory(date: date, totalExpenditure: action.totalExpenditure,
                                    restingEnergy: action.restingEnergy, activeEnergy: action.activeEnergy,
                                    consumed: action.consumed)
            return .init(ok: true, message: "Updated \(date).")

        case "setGoals":
            var next = store.goalValues
            if let v = action.calorieBalancePercent { next.calorieBalancePercent = v }
            if let v = action.proteinGoal { next.protein = v }
            if let v = action.carbsGoal { next.carbs = v }
            if let v = action.fatGoal { next.fat = v }
            if let v = action.fiberGoal { next.fiber = v }
            if let v = action.stepsGoal { next.steps = v }
            if let v = action.sleepHoursGoal { next.sleepHours = v }
            await store.saveGoals(next)
            return .init(ok: true, message: "Goals updated.")

        case "addRecipe":
            guard let name = action.recipeName, !name.isEmpty else { return .init(ok: false, message: "I need a name for the recipe.") }
            let lines = (action.ingredients ?? "")
                .components(separatedBy: .newlines)
                .map { $0.trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
            let saved = await store.addRecipe(name: name, ingredients: lines, servings: action.servings)
            return saved
                ? .init(ok: true, message: "Added \(name) to the recipe bank.")
                : .init(ok: false, message: "That recipe couldn't be saved.")

        case "setSetting":
            return applySetting(action)

        case "updateContext":
            guard let addition = action.contextAddition, !addition.isEmpty else {
                return .init(ok: false, message: "I didn't catch what to remember.")
            }
            // Appends rather than replaces: saveContext overwrites the whole field, so
            // sending only the new sentence would silently drop everything already there.
            let existing = store.context.trimmingCharacters(in: .whitespacesAndNewlines)
            await store.saveContext(existing.isEmpty ? addition : existing + "\n" + addition)
            return .init(ok: true, message: "Added that to your preferences.")

        default:
            return .init(ok: false, message: "I can't do that one yet.")
        }
    }

    private static func applySetting(_ action: CoachAction) -> Result {
        switch action.setting {
        case "darkMode":
            guard let on = action.enabled else { return .init(ok: false, message: "On or off?") }
            UserDefaults.standard.set(on, forKey: "fuelDarkMode")
            return .init(ok: true, message: "Dark mode \(on ? "on" : "off").")
        case "backgroundSync":
            guard let on = action.enabled else { return .init(ok: false, message: "On or off?") }
            SyncStore.shared.backgroundSyncEnabled = on
            return .init(ok: true, message: "Background sync \(on ? "on" : "off").")
        case "syncQuantitySamples":
            guard let on = action.enabled else { return .init(ok: false, message: "On or off?") }
            SyncStore.shared.syncQuantitySamples = on
            return .init(ok: true, message: "Activity & vitals sync \(on ? "on" : "off").")
        case "syncCategorySamples":
            guard let on = action.enabled else { return .init(ok: false, message: "On or off?") }
            SyncStore.shared.syncCategorySamples = on
            return .init(ok: true, message: "Sleep & category sync \(on ? "on" : "off").")
        case "syncWorkouts":
            guard let on = action.enabled else { return .init(ok: false, message: "On or off?") }
            SyncStore.shared.syncWorkouts = on
            return .init(ok: true, message: "Workout sync \(on ? "on" : "off").")
        case "syncWorkoutRoutes":
            guard let on = action.enabled else { return .init(ok: false, message: "On or off?") }
            SyncStore.shared.syncWorkoutRoutes = on
            return .init(ok: true, message: "Workout route sync \(on ? "on" : "off").")
        case "palette":
            guard let name = action.paletteName,
                  let preset = DashboardPalette.presets.first(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame })
            else { return .init(ok: false, message: "I don't know that palette.") }
            DashboardTheme.shared.apply(preset)
            return .init(ok: true, message: "Switched to the \(preset.name) palette.")
        default:
            return .init(ok: false, message: "I don't know that setting.")
        }
    }

    /// Finds the entry a phrase refers to. Exact match first, then a contains match, so
    /// "the burrito" resolves against "Chicken burrito bowl"; most recent wins a tie.
    private static func matchEntry(_ phrase: String?, in store: AppStore) -> FoodEntry? {
        guard let phrase = phrase?.trimmingCharacters(in: .whitespaces).lowercased(), !phrase.isEmpty,
              let entries = store.dashboard?.today.foodEntries, !entries.isEmpty else { return nil }
        if let exact = entries.last(where: { ($0.food ?? "").lowercased() == phrase }) { return exact }
        return entries.last { ($0.food ?? "").lowercased().contains(phrase) }
    }
}
