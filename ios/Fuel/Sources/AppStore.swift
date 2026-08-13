import Foundation
import SwiftUI
import UIKit
import HealthKit
import CoreLocation

// Everything the app knows, in one observable place.
//
// Health data does not arrive via Health Logger or a Shortcut: Fuel reads HealthKit
// itself, through the same anchored replication engine, and posts to the same
// /api/health/sync/v1. One app instead of two, and the dashboard reflects a workout
// minutes after it ends without the user doing anything.
//
// Sign-in is the website's own Google account, or Apple — verified server-side and
// matched on the same email, so the app and the site are the same account.

struct ChatMessage: Identifiable, Equatable {
    enum Role: Equatable { case user, coach }
    let id = UUID()
    var role: Role
    var text: String
    /// Set when the message is a logged meal, so the transcript shows what went in.
    var loggedFood: String?
    var photo: Data?
    /// Set when this message IS a generated day plan, so the transcript can find and
    /// drop the previous one when a new plan is built — only one is ever kept.
    var isPlan: Bool = false
    /// A change the Coach proposed and is waiting to be confirmed. Nothing is applied
    /// until the person taps Confirm; cleared once they answer either way.
    var pendingAction: CoachAction?
}

@MainActor
@Observable
final class AppStore {
    static let shared = AppStore()

    var dashboard: Dashboard?
    var loading = false
    var error: String?
    var context: String = ""

    /// How many health syncs are running. Drives the progress bar across the top of the
    /// app: a sync fires on launch, on foreground, on pull-to-refresh and from the
    /// background, and until now the only sign any of it was happening was the More
    /// screen's status line.
    private(set) var syncsInFlight = 0
    var isSyncing: Bool { syncsInFlight > 0 }

    /// The Coach transcript. Kept in memory for the session and replayed into the model
    /// as conversation history, so follow-ups like "what about carbs?" make sense.
    var messages: [ChatMessage] = []
    var coachThinking = false

    var logging = false
    var lastLogged: String?

    /// The website's editable dashboard state: which sections show and in what order,
    /// the goal targets, and the per-day energy overrides. All server-backed, so the
    /// phone and the browser agree.
    var layout = DashboardLayout.default
    var goalValues = GoalValues()
    var history: [HistoryDay] = []
    var places: PlaceHeatmap?

    let auth: SignIn

    var baseURL: String {
        didSet {
            UserDefaults.standard.set(baseURL, forKey: "fuelBaseURL")
            syncEndpointFromBase()
            auth.updateBaseURL(baseURL)
        }
    }

    var healthAuthorized = UserDefaults.standard.bool(forKey: "hkAuthorized")
    var isSignedIn: Bool { auth.isSignedIn }

    private init() {
        let url = UserDefaults.standard.string(forKey: "fuelBaseURL") ?? FuelClient.defaultBaseURL
        baseURL = url
        auth = SignIn(baseURL: url)
        syncEndpointFromBase()
    }

    /// Keep the health-sync endpoint pointed at whatever server the app talks to, so
    /// switching to a self-hosted Fuel moves both halves together. A server change
    /// invalidates any cached sync token from the old one.
    private func syncEndpointFromBase() {
        SyncStore.shared.endpoint = baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            + "/api/health/sync/v1"
        healthSyncToken = nil
    }

    private func client() async throws -> FuelClient {
        guard let token = await auth.accessToken() else { throw FuelClientError.notConfigured }
        return try FuelClient(baseURL: baseURL, token: token)
    }

    /// The dedicated long-lived bearer token /api/health/sync/v1 requires — a
    /// different credential from the OAuth access token the rest of the API uses, and
    /// on purpose: it is a separate, narrower trust boundary that a Shortcut or the
    /// Health Logger app can hold indefinitely without ever seeing a Google session.
    /// Minted once via GET /api/health/token (itself authenticated with the OAuth
    /// token) and cached here rather than refetched on every sync.
    private var healthSyncToken: String?

    private struct HealthSyncTokenResponse: Decodable { let token: String }

    private func ensureHealthSyncToken() async -> String? {
        if let healthSyncToken { return healthSyncToken }
        guard let accessToken = await auth.accessToken(),
              let url = URL(string: baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/api/health/token")
        else { return nil }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let decoded = try? JSONDecoder().decode(HealthSyncTokenResponse.self, from: data)
        else { return nil }
        healthSyncToken = decoded.token
        return decoded.token
    }

    // MARK: - Loading

    func load() async {
        guard isSignedIn else { return }
        loading = true
        defer { loading = false }
        do {
            dashboard = try await client().dashboard()
            error = nil
            WidgetPublisher.publish(dashboard: dashboard, goals: goalValues)
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Layout and goals ride alongside the dashboard rather than blocking it — a slow
    /// goals read should not hold up the numbers.
    func loadEditableState() async {
        guard isSignedIn else { return }
        async let layoutResult = try? client().layout()
        async let goalsResult = try? client().goals()
        if let value = await layoutResult { layout = value }
        if let value = await goalsResult { goalValues = value }
        WidgetPublisher.publish(dashboard: dashboard, goals: goalValues)
    }

    /// Re-fetches goals on demand — used when the Goals sheet opens, so it never shows
    /// stale (or, if the one-shot loadEditableState() call raced or failed silently,
    /// still-default/empty) values.
    func loadGoals() async {
        guard isSignedIn else { return }
        do { goalValues = try await client().goals() } catch { self.error = error.localizedDescription }
    }

    func saveLayout(_ next: DashboardLayout) async {
        layout = next
        do { try await client().saveLayout(next) } catch { self.error = error.localizedDescription }
    }

    func saveGoals(_ next: GoalValues) async {
        goalValues = next
        do {
            try await client().saveGoals(next)
            await load()
        } catch { self.error = error.localizedDescription }
    }

    func loadHistory() async {
        guard isSignedIn else { return }
        history = (try? await client().history()) ?? []
    }

    func saveHistory(date: String, totalExpenditure: Double?, restingEnergy: Double?,
                     activeEnergy: Double?, consumed: Double?) async {
        do {
            try await client().saveHistory(date: date, totalExpenditure: totalExpenditure,
                                           restingEnergy: restingEnergy, activeEnergy: activeEnergy,
                                           consumed: consumed)
            await loadHistory()
            await load()
        } catch { self.error = error.localizedDescription }
    }

    // MARK: - Places

    func loadPlaces(days: Int = 30) async {
        guard isSignedIn else { return }
        do { places = try await client().places(days: days) } catch { self.error = error.localizedDescription }
    }

    func renamePlace(_ placeId: String, label: String) async {
        do { try await client().renamePlace(placeId, label: label); await loadPlaces() }
        catch { self.error = error.localizedDescription }
    }

    func clearPlaces() async {
        do { try await client().clearPlaces(); await loadPlaces() }
        catch { self.error = error.localizedDescription }
    }

    /// Gives unnamed places a real name, one at a time and spaced out — the lookup is
    /// rate-limited upstream and cached server-side, exactly like the website's version.
    func identifyPendingPlaces() async {
        guard let pending = places?.places.filter({ $0.label == nil && !$0.identified && $0.samples > 0 }),
              !pending.isEmpty else { return }
        for place in pending {
            guard let result = try? await client().identifyPlace(place.id) else { continue }
            if let index = places?.places.firstIndex(where: { $0.id == place.id }) {
                places?.places[index].suggestedLabel = result.suggestedLabel
                places?.places[index].suggestedDetail = result.suggestedDetail
                places?.places[index].identified = result.identified ?? true
            }
            try? await Task.sleep(for: .seconds(1.1))
        }
    }

    /// Fire-and-forget, mirroring the website's own capture: a failure here (offline,
    /// inaccurate fix, throttled) is never worth surfacing to the user.
    func recordLocation(_ location: CLLocation) async {
        guard isSignedIn else { return }
        let accuracy = location.horizontalAccuracy >= 0 ? location.horizontalAccuracy : nil
        _ = try? await client().recordLocation(latitude: location.coordinate.latitude,
                                               longitude: location.coordinate.longitude, accuracy: accuracy)
    }

    // MARK: - Recipes

    /// Logs one serving of a shared recipe. A recipe with no nutrition yet is estimated
    /// on-device once, then logged — matching the website's single-retry
    /// backfill-then-log flow, except the estimate itself never leaves this phone; only
    /// the resulting numbers are sent to the server.
    @discardableResult
    func logRecipe(_ recipe: Recipe) async -> Bool {
        guard let id = recipe.id else { return false }
        do {
            var outcome = try await client().logRecipe(recipeId: id)
            if !outcome.ok, outcome.needsNutrition {
                if let estimate = try? await OnDeviceAI.shared.estimateRecipeNutrition(
                    name: recipe.name ?? "Recipe", ingredients: recipe.ingredients ?? [], serving: recipe.serving) {
                    _ = try? await client().saveRecipeNutrition(recipeId: outcome.recipeId ?? id, nutrition: estimate)
                }
                outcome = try await client().logRecipe(recipeId: id)
            }
            if outcome.ok { await load() }
            return outcome.ok
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func fillRecipeNutrition(_ recipe: Recipe) async {
        guard let id = recipe.id else { return }
        do {
            let estimate = try await OnDeviceAI.shared.estimateRecipeNutrition(
                name: recipe.name ?? "Recipe", ingredients: recipe.ingredients ?? [], serving: recipe.serving)
            _ = try await client().saveRecipeNutrition(recipeId: id, nutrition: estimate)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Fills in every recipe missing nutrition, one on-device estimate at a time. No
    /// quota to run into and nothing to batch — the reason the web version needed
    /// both — so this just walks the list once (mirrors fillMissingNutrition's own
    /// reasoning for food entries).
    @discardableResult
    func fillPendingRecipeNutrition() async -> Int {
        var filled = 0
        do {
            let pending = try await client().recipesNeedingNutrition()
            for entry in pending {
                guard let recipe = dashboard?.recipes?.first(where: { $0.id == entry.id }) else { continue }
                guard let estimate = try? await OnDeviceAI.shared.estimateRecipeNutrition(
                    name: recipe.name ?? entry.name, ingredients: recipe.ingredients ?? [], serving: recipe.serving) else { continue }
                if (try? await client().saveRecipeNutrition(recipeId: entry.id, nutrition: estimate)) != nil { filled += 1 }
            }
        } catch {
            self.error = error.localizedDescription
        }
        if filled > 0 { await load() }
        return filled
    }

    func updateFood(_ entry: FoodEntry, description: String, meal: String?, portion: String?,
                    calories: Double?, protein: Double?, carbs: Double?, fat: Double?, fiber: Double?) async {
        do {
            try await client().updateFood(id: entry.id, description: description, meal: meal, portion: portion,
                                          calories: calories, protein: protein, carbs: carbs,
                                          fat: fat, fiber: fiber)
            await load()
        } catch { self.error = error.localizedDescription }
    }

    func loadContext() async {
        guard isSignedIn, context.isEmpty else { return }
        context = (try? await client().userContext()) ?? ""
    }

    /// Replaces the complete stored context, exactly as the website's editor does.
    func saveContext(_ text: String) async {
        do { context = try await client().saveUserContext(text) }
        catch { self.error = error.localizedDescription }
    }

    /// "Learn from me": a compact digest of what has actually been logged — trends,
    /// recently-eaten foods, frequently-visited places — handed to the AI to mine short,
    /// durable observations from. Returns bullets for the caller to append to context;
    /// nothing here writes anything itself, so the stored preferences are never at risk
    /// even if this is called repeatedly.
    func learnFromMe() async throws -> [String] {
        if savedMeals.isEmpty && foodHistory.isEmpty { await loadLibrary() }
        let places = try? await client().places(days: 30)

        var lines: [String] = []
        let trends = dashboard?.trends ?? []
        let loggedDays = trends.filter { $0.caloriesConsumed != nil }
        if !loggedDays.isEmpty {
            lines.append("Food logged on \(loggedDays.count) of the last \(trends.count) days.")
            if let avg = average(loggedDays.compactMap(\.caloriesConsumed)) {
                lines.append("Average calories eaten on logged days: \(Int(avg)) kcal.")
            }
            if let avg = average(loggedDays.compactMap(\.protein)) {
                lines.append("Average protein: \(Int(avg)) g.")
            }
        }
        if let avg = average(trends.compactMap(\.sleepHours)) {
            lines.append("Average sleep: \(String(format: "%.1f", avg)) hours.")
        }
        let activeDays = trends.filter { ($0.exerciseMinutes ?? 0) > 0 }
        if !activeDays.isEmpty {
            lines.append("Exercised on \(activeDays.count) of the last \(trends.count) days.")
            if let avg = average(activeDays.compactMap(\.exerciseMinutes)) {
                lines.append("Average exercise minutes on those days: \(Int(avg)) min.")
            }
        }
        if !foodHistory.isEmpty {
            lines.append("Recently logged foods: " + foodHistory.prefix(15).map(\.description).joined(separator: ", ") + ".")
        }
        if let notable = places?.places.filter({ !$0.likelyHome }).prefix(5), !notable.isEmpty {
            lines.append("Frequently visited places besides home: "
                + notable.map { $0.label ?? $0.suggestedLabel ?? "an unnamed place" }.joined(separator: ", ") + ".")
        }

        guard !lines.isEmpty else { return [] }
        return try await OnDeviceAI.shared.learnFromData(digest: lines.joined(separator: "\n"), existingContext: context)
    }

    private func average(_ values: [Double]) -> Double? {
        guard !values.isEmpty else { return nil }
        return values.reduce(0, +) / Double(values.count)
    }

    // MARK: - Food

    /// The user's own saved meals and their previously-logged foods. Loaded lazily when
    /// the log library opens rather than on every dashboard read: neither is needed to
    /// render Today, and both change only when the user acts.
    var savedMeals: [SavedMeal] = []
    var foodHistory: [FoodHistoryItem] = []
    var libraryLoading = false

    // MARK: - Day paging on Today

    /// How far back the horizontal swipe on Today currently sits: 0 is today, 1 is
    /// yesterday, 2 the day before, and so on.
    var dayOffset = 0
    private var dayDetailCache: [String: DayDetail] = [:]
    var dayDetailLoading = false

    /// Every date `dayOffset` can land on, oldest first — bounded by however much
    /// history `trends` actually carries, so paging stops rather than requesting a day
    /// with nothing to show.
    private var pageableDates: [String] { (dashboard?.trends ?? []).map(\.date).sorted() }

    var viewingDate: String? {
        let dates = pageableDates
        guard !dates.isEmpty else { return dashboard?.today.summary.date }
        let index = dates.count - 1 - dayOffset
        return dates.indices.contains(index) ? dates[index] : dates.first
    }

    var isViewingToday: Bool { dayOffset == 0 }

    var viewingSummary: DaySummary? {
        guard !isViewingToday, let date = viewingDate else { return dashboard?.today.summary }
        return dashboard?.trends.first { $0.date == date } ?? dashboard?.today.summary
    }

    var viewingFoodEntries: [FoodEntry] {
        guard !isViewingToday, let date = viewingDate else { return dashboard?.today.foodEntries ?? [] }
        return dayDetailCache[date]?.foodEntries ?? []
    }

    var viewingWorkouts: [Workout] {
        guard !isViewingToday, let date = viewingDate else { return dashboard?.today.workouts ?? [] }
        return dayDetailCache[date]?.workouts ?? []
    }

    var viewingSupplements: [Supplement] {
        guard !isViewingToday, let date = viewingDate else { return dashboard?.today.supplements ?? [] }
        return dayDetailCache[date]?.supplements ?? []
    }

    /// Whether swiping further in the requested direction would land on a real day.
    /// -1 = toward today (a smaller offset), 1 = further into the past.
    func canPage(_ direction: Int) -> Bool {
        let target = dayOffset + direction
        guard target >= 0 else { return false }
        let dates = pageableDates
        guard !dates.isEmpty else { return target == 0 }
        return dates.indices.contains(dates.count - 1 - target)
    }

    func page(_ direction: Int) {
        guard canPage(direction) else { return }
        dayOffset += direction
        Task { await loadViewingDay() }
    }

    func resetToToday() { dayOffset = 0 }

    /// Fetches whatever the current `dayOffset` is missing. Today needs nothing — its
    /// food, workouts and supplements are already on the dashboard payload — so this
    /// only ever calls the network for a day actually being paged back to.
    func loadViewingDay() async {
        guard !isViewingToday, let date = viewingDate, dayDetailCache[date] == nil else { return }
        dayDetailLoading = true
        defer { dayDetailLoading = false }
        do {
            dayDetailCache[date] = try await client().dayDetail(date: date)
        } catch {
            // Left uncached on failure so the next visit to this day retries the fetch
            // instead of silently showing an empty day forever.
        }
    }

    /// The entry the app just created, so Today can scroll to it and flash it. Logging
    /// used to end with the camera still on screen and a one-line "Logged X" — which
    /// never showed what actually landed in the day, only that something had.
    var highlightedEntryID: String?
    /// Set alongside it; RootView consumes this to switch tabs and clears it.
    var jumpToToday = false

    /// Finds the row the log produced and points Today at it. Matching on description
    /// rather than an id because the log endpoint returns no id — the freshest entry
    /// whose text matches is the one just written.
    private func highlightNewest(_ description: String) {
        let needle = description.trimmingCharacters(in: .whitespaces).lowercased()
        let match = dashboard?.today.foodEntries.last { entry in
            (entry.food ?? entry.meal ?? "").trimmingCharacters(in: .whitespaces).lowercased() == needle
        }
        highlightedEntryID = (match ?? dashboard?.today.foodEntries.last)?.id
        jumpToToday = true
    }

    func logFood(description: String, meal: String?, portion: String?, nutrition: EstimatedNutrition?) async {
        do {
            let fix = await LocationSampler.shared.fixForLogging()
            try await client().logFood(description: description, meal: meal, portion: portion,
                                       calories: nutrition?.calories, protein: nutrition?.protein,
                                       carbs: nutrition?.carbs, fat: nutrition?.fat, fiber: nutrition?.fiber,
                                       at: fix)
            await load()
            highlightNewest(description)
            announceLogged(description, nutrition: nutrition, photo: nil)
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - The log library

    /// Loads the two server-backed shelves of the log library. Common foods need no
    /// fetch — they ship with the app — so the library is usable offline even when this
    /// fails.
    func loadLibrary() async {
        guard isSignedIn else { return }
        libraryLoading = true
        defer { libraryLoading = false }
        async let meals = try? client().savedMeals()
        async let history = try? client().foodHistory()
        savedMeals = await meals ?? savedMeals
        foodHistory = await history ?? foodHistory
    }

    func logSavedMeal(_ meal: SavedMeal) async {
        do {
            let fix = await LocationSampler.shared.fixForLogging()
            try await client().logSavedMeal(id: meal.id, at: fix)
            await load()
            highlightNewest(meal.items.first?.description ?? meal.name)
            announceLogged(meal.name, nutrition: nil, photo: nil)
            await loadLibrary()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Saves entries already in the diary as a reusable meal.
    @discardableResult
    func saveMeal(named name: String?, fromEntryIDs ids: [String]) async -> Bool {
        do {
            let meal = try await client().createMeal(name: name, fromEntryIDs: ids)
            savedMeals.insert(meal, at: 0)
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    @discardableResult
    func saveMeal(named name: String, meal: String?, items: [SavedMeal.Item]) async -> Bool {
        do {
            let created = try await client().createMeal(name: name, meal: meal, items: items)
            savedMeals.insert(created, at: 0)
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func deleteSavedMeal(_ meal: SavedMeal) async {
        savedMeals.removeAll { $0.id == meal.id }
        try? await client().deleteSavedMeal(id: meal.id)
    }

    /// The camera path: identify on device and log it. The coach no longer reacts
    /// automatically — a plan is only ever built by the explicit "New plan" action.
    func logPhoto(_ photo: Data, note: String?) async {
        logging = true
        defer { logging = false }
        do {
            let identified = try await OnDeviceAI.shared.identifyMeal(photo: photo, note: note)
            let fix = await LocationSampler.shared.fixForLogging()
            try await client().logFood(description: identified.name, meal: identified.meal,
                                       portion: identified.portion,
                                       calories: identified.nutrition.calories,
                                       protein: identified.nutrition.protein,
                                       carbs: identified.nutrition.carbs,
                                       fat: identified.nutrition.fat,
                                       fiber: identified.nutrition.fiber,
                                       notes: note, at: fix)
            lastLogged = identified.name
            await load()
            highlightNewest(identified.name)
            announceLogged(identified.name, nutrition: identified.nutrition, photo: photo)
            // Clear the confirmation after a beat so the camera goes back to being a camera.
            try? await Task.sleep(for: .seconds(3))
            lastLogged = nil
        } catch {
            self.error = error.localizedDescription
            lastLogged = nil
        }
    }

    /// Drops the meal into the Coach transcript. Logging never builds a plan by
    /// itself — only the explicit "New plan" action (generateNewPlan) does that.
    private func announceLogged(_ food: String, nutrition: EstimatedNutrition?, photo: Data?) {
        let macros = nutrition.map {
            " (\(Format.kcal($0.calories)) kcal, \(Format.number($0.protein)) g protein)"
        } ?? ""
        messages.append(ChatMessage(role: .user, text: "Logged \(food)\(macros)", loggedFood: food, photo: photo))
    }

    /// The only way a plan is ever (re)built — the explicit "New plan" action. Any
    /// earlier plan message is dropped first, so only the most recent plan is ever
    /// shown in the transcript.
    func generateNewPlan() async {
        guard let summary = dashboard?.today.summary, OnDeviceAI.shared.isUsable else { return }
        coachThinking = true
        defer { coachThinking = false }
        do {
            let plan = try await OnDeviceAI.shared.planRestOfDay(
                justLogged: lastLogged, summary: summary, goals: dashboard?.goals, context: context)
            messages.removeAll { $0.isPlan }
            messages.append(ChatMessage(role: .coach, text: plan, isPlan: true))
        } catch {
            messages.append(ChatMessage(role: .coach, text: "I couldn't put a plan together just now."))
        }
    }

    func deleteFood(_ entry: FoodEntry) async {
        do {
            try await client().deleteFood(id: entry.id)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Deletes several entries as one operation — a single dashboard reload afterward
    /// rather than one per entry, which would otherwise flicker the whole card once per
    /// selected row.
    func deleteFoods(_ ids: [String]) async {
        for id in ids {
            do { try await client().deleteFood(id: id) }
            catch { self.error = error.localizedDescription }
        }
        await load()
    }

    /// Fills missing macros for today's food with the on-device model, one entry at a
    /// time. No quota to run into, so there is no batching and no backoff — the reason
    /// the web version needed both.
    func fillMissingNutrition(progress: @escaping (Int, Int) -> Void) async {
        guard let entries = dashboard?.today.foodEntries.filter({ $0.needsNutrition }), !entries.isEmpty else { return }
        var done = 0
        for entry in entries {
            progress(done, entries.count)
            guard let food = entry.food, !food.isEmpty else { done += 1; continue }
            do {
                let estimate = try await OnDeviceAI.shared.estimateNutrition(food: food, portion: entry.portion)
                try await client().updateFood(id: entry.id, description: food, meal: entry.meal, portion: entry.portion,
                                              calories: estimate.calories ?? entry.calories,
                                              protein: estimate.protein ?? entry.protein,
                                              carbs: estimate.carbs ?? entry.carbs,
                                              fat: estimate.fat ?? entry.fat,
                                              fiber: estimate.fiber ?? entry.fiber)
            } catch {
                self.error = error.localizedDescription
            }
            done += 1
            progress(done, entries.count)
        }
        await load()
    }

    // MARK: - Coach

    func askCoach(_ question: String) async {
        guard let summary = dashboard?.today.summary else { return }
        messages.append(ChatMessage(role: .user, text: question))
        coachThinking = true
        defer { coachThinking = false }

        // "Change my protein goal to 160" is a command, not a question. Interpreting
        // first means such a message becomes a confirmable action instead of the model
        // cheerfully describing a change it has no way to make.
        if let action = await interpretAction(question), action.isActionable {
            messages.append(ChatMessage(role: .coach, text: action.summary, pendingAction: action))
            return
        }

        // A placeholder the stream fills in, so text appears as it generates.
        let index = messages.count
        messages.append(ChatMessage(role: .coach, text: ""))

        // Ask iOS to keep us running if the person leaves mid-answer. Without this the
        // app is suspended on the way out and the half-written reply is what they come
        // back to — so the useful thing to do after asking a question would be to stand
        // there and watch it type.
        let task = UIApplication.shared.beginBackgroundTask(withName: "coach reply")
        defer { if task != .invalid { UIApplication.shared.endBackgroundTask(task) } }

        do {
            let stream = OnDeviceAI.shared.ask(question, summary: summary,
                                               dashboard: dashboard, history: messages,
                                               context: context)
            for try await partial in stream {
                if messages.indices.contains(index) { messages[index].text = partial }
            }
            await announceIfAway(messages.indices.contains(index) ? messages[index].text : "")
        } catch {
            if messages.indices.contains(index) { messages[index].text = error.localizedDescription }
        }
    }

    /// Notifies only when the answer landed while the person was elsewhere. In the
    /// foreground the reply is already on screen and a banner would be telling them
    /// something they can see.
    private func announceIfAway(_ text: String) async {
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        await Notifications.shared.postReply(text)
    }

    /// Nil when interpretation fails for any reason. A model that can't produce a clean
    /// action should leave the message to be answered as an ordinary question rather
    /// than surface an error for something the person never asked for.
    private func interpretAction(_ question: String) async -> CoachAction? {
        guard CoachActions.looksLikeCommand(question) else { return nil }
        let foods = (dashboard?.today.foodEntries ?? []).compactMap(\.food)
        let today = dashboard?.today.summary.date ?? String(ISO8601DateFormatter().string(from: Date()).prefix(10))
        return try? await OnDeviceAI.shared.interpret(question, todayFoods: foods, today: today)
    }

    /// Applies a proposed change once the person has confirmed it, and replaces the
    /// card with what actually happened.
    func confirmAction(_ message: ChatMessage) async {
        guard let index = messages.firstIndex(where: { $0.id == message.id }),
              let action = messages[index].pendingAction else { return }
        messages[index].pendingAction = nil
        coachThinking = true
        defer { coachThinking = false }
        let result = await CoachActions.execute(action, store: self)
        messages[index].text = result.message
    }

    func cancelAction(_ message: ChatMessage) {
        guard let index = messages.firstIndex(where: { $0.id == message.id }) else { return }
        messages[index].pendingAction = nil
        messages[index].text = "Cancelled — nothing was changed."
    }

    /// Adds a recipe to the shared bank. Returns whether it saved, so the Coach can say
    /// so plainly rather than claiming success on a failed write.
    func addRecipe(name: String, ingredients: [String], servings: Double?,
                   nutrition: EstimatedNutrition?) async -> Bool {
        do {
            try await client().createRecipe(name: name, ingredients: ingredients,
                                            servings: servings, nutrition: nutrition)
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    // MARK: - Health

    func requestHealthAccess() async {
        do {
            try await SyncEngine.shared.requestAuthorization()
            healthAuthorized = true
            UserDefaults.standard.set(true, forKey: "hkAuthorized")
            await BackgroundSync.enableHealthKitDelivery()
            await syncHealth(reason: "first authorization")
        } catch {
            self.error = "Health access failed: \(error.localizedDescription)"
        }
    }

    func syncHealth(reason: String) async {
        guard isSignedIn, healthAuthorized else { return }
        // Counted rather than a bare bool: a pull-to-refresh landing on top of the
        // app-foreground sync would otherwise have the first one to finish clear the
        // bar while the second is still running.
        syncsInFlight += 1
        defer { syncsInFlight = max(0, syncsInFlight - 1) }
        guard let token = await ensureHealthSyncToken() else { return }
        SyncStore.shared.token = token
        _ = await SyncEngine.shared.sync(reason: reason)
        await load()
        await reactToNewWorkouts()
        await sendWeeklyRundownIfDue()
    }

    /// Congratulates the person on a workout that just arrived and follows it with one
    /// concrete suggestion drawn from the rest of the day — vitals, what they have eaten,
    /// how the week is trending. The reaction goes into the Coach transcript and, if they
    /// are not in the app, out as a notification.
    ///
    /// Deduplicated by workout identity rather than by "have we run today", so a second
    /// session in one afternoon is still recognised while the first is not repeated on
    /// every sync.
    private func reactToNewWorkouts() async {
        guard Notifications.shared.canReactToWorkouts, OnDeviceAI.shared.isUsable else { return }
        guard let summary = dashboard?.today.summary else { return }
        let workouts = dashboard?.today.workouts ?? []
        guard !workouts.isEmpty else { return }

        for workout in workouts {
            let key = "\(summary.date)|\(workout.id)"
            guard Notifications.shared.isNewWorkout(key) else { continue }
            // Marked before generating, not after: a failed or slow generation must not
            // leave the workout eligible to be announced again on the next sync.
            Notifications.shared.markWorkoutSeen(key)

            let described = [workout.activity,
                             workout.distanceMiles.map { "\(Format.number($0, decimals: 1)) miles" },
                             workout.swimmingDistanceYards.map { "\(Format.number($0)) yards swum" }]
                .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")

            let prompt = """
            I just finished a workout: \(described.isEmpty ? "a training session" : described). \
            Congratulate me in one short sentence, then give me one specific, useful suggestion \
            for the rest of today based on my vitals, what I have eaten so far and my recent trends. \
            Keep the whole thing under 60 words and do not use headings or lists.
            """

            var reply = ""
            do {
                for try await partial in OnDeviceAI.shared.ask(prompt, summary: summary,
                                                               dashboard: dashboard, history: [],
                                                               context: context) {
                    reply = partial
                }
            } catch {
                continue
            }
            let text = reply.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }
            messages.append(ChatMessage(role: .coach, text: text))
            await Notifications.shared.postProactive(text, title: "Nice session")
        }
    }

    /// Once a week — Saturday morning — a rundown of how the week went: workouts,
    /// sleep, meal habits, what's working and what needs work. There is no server push
    /// behind this: it is purely opportunistic, checked on every sync the same way a
    /// workout reaction is, and simply fires the first time that check happens to land
    /// on a Saturday morning.
    private func sendWeeklyRundownIfDue() async {
        guard Notifications.shared.canSendWeeklyRundown, OnDeviceAI.shared.isUsable else { return }
        guard Notifications.shared.isDueForWeeklyRundown() else { return }
        guard let summary = dashboard?.today.summary else { return }
        // Marked before generating, so a failed or slow generation cannot leave this
        // week eligible to fire again on the next sync a few minutes later.
        Notifications.shared.markWeeklyRundownSent()

        let week = (dashboard?.trends ?? []).suffix(7)
        guard !week.isEmpty else { return }
        var lines = ["THE LAST 7 DAYS:"]
        for day in week {
            var parts = [day.date]
            if let cal = day.caloriesConsumed { parts.append("\(Int(cal)) kcal eaten") }
            if let ex = day.exerciseMinutes, ex > 0 { parts.append("\(Int(ex)) min exercise") }
            if let sleep = day.sleepHours { parts.append("\(String(format: "%.1f", sleep))h sleep") }
            if let steps = day.stepCount { parts.append("\(Int(steps)) steps") }
            lines.append("- " + parts.joined(separator: ", "))
        }

        let prompt = """
        Here is my last 7 days of data:
        \(lines.joined(separator: "\n"))

        Give me a short weekly rundown: how many days had a workout, how that lined up \
        with my sleep, how my eating went, what was good and what could use work. Write \
        it as a friendly paragraph or two, under 120 words, no headings or lists. Only \
        use what's in the data above — do not invent specific times or activities it \
        doesn't give you.
        """

        var reply = ""
        do {
            for try await partial in OnDeviceAI.shared.ask(prompt, summary: summary,
                                                           dashboard: dashboard, history: [],
                                                           context: context) {
                reply = partial
            }
        } catch { return }
        let text = reply.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        messages.append(ChatMessage(role: .coach, text: text))
        await Notifications.shared.postProactive(text, title: "Your week")
    }

    /// Wraps auth.signOut() so the cached sync token — minted for whoever was signed
    /// in — never survives into a different account's session on the same device.
    func signOut() {
        healthSyncToken = nil
        SyncStore.shared.token = ""
        auth.signOut()
    }

    var healthStatus: String {
        switch SyncStore.shared.status {
        case .idle:
            guard let at = SyncStore.shared.lastSyncAt else { return "Not synced yet" }
            return "Synced \(at.formatted(.relative(presentation: .named)))"
        case .running(let stage): return stage
        case .failed(let message): return message
        }
    }
}
