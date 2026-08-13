import Foundation

// The Fuel web API, as the phone sees it. Same endpoints the website calls and the
// same database behind them — the only difference is the credential: the app sends the
// bearer sync token, which api/mlog.js already accepts alongside the browser session.
//
// Named FuelClient rather than FuelAPI because the shared HealthKit sync sources bring
// their own FuelAPI (the /api/health/sync/v1 client) into this target.

// MARK: - Dashboard models

struct Dashboard: Decodable {
    var generatedAt: String?
    var energyAverages: EnergyAverages?
    var today: Today
    var goals: Goals?
    var goalProfile: GoalProfile?
    var trends: [DaySummary]
    var recipes: [Recipe]?
    var intradayEnergy: IntradayEnergy?
    var rolling24h: Rolling24h?
    var coverage: Coverage?
}

/// Height/weight/age/objective — the personal-profile half of user_goals. Age is the
/// only field Compare needs, but the rest rides along since the server always sends it.
struct GoalProfile: Decodable {
    var heightIn: Double?
    var weightLb: Double?
    var age: Int?
    var objective: String?
}

struct EnergyAverages: Decodable {
    var totalExpenditure: Double?
    var restingEnergy: Double?
    var activeEnergy: Double?
    var energyBalance: Double?
}

struct Today: Decodable {
    var summary: DaySummary
    var foodEntries: [FoodEntry]
    var workouts: [Workout]?
    var supplements: [Supplement]?
}

/// Everything about a day other than its summary — fetched only when the day-paging
/// swipe on Today lands on a day that isn't today, since the summary itself is already
/// in `Dashboard.trends`.
struct DayDetail: Decodable {
    var foodEntries: [FoodEntry]
    var workouts: [Workout]?
    var supplements: [Supplement]?
}

/// One day, whether it's today's summary or a point on the trend line — the server
/// sends the same shape for both.
/// The 39 micronutrients the website's detailed-nutrition grid can show. Decoded as a
/// dictionary rather than 39 properties: the server sends only what was actually
/// tracked, and the grid renders only what is present.
typealias Nutrients = [String: Double]

struct DaySummary: Decodable, Identifiable {
    var date: String
    var partialDay: Bool?
    var caloriesConsumed: Double?
    var restingEnergy: Double?
    var activeEnergy: Double?
    var totalExpenditure: Double?
    var energyBalance: Double?
    var protein: Double?
    var carbs: Double?
    var fat: Double?
    var fiber: Double?
    var sugars: Double?
    var addedSugars: Double?
    var sodium: Double?
    var caffeine: Double?
    var sleepHours: Double?
    var restingHeartRate: Double?
    var hrv: Double?
    var respiratoryRate: Double?
    var bloodOxygen: Double?
    var walkingHeartRateAverage: Double?
    var stepCount: Double?
    var distanceMiles: Double?
    var cyclingDistanceMiles: Double?
    var flightsClimbed: Double?
    var exerciseMinutes: Double?
    var standMinutes: Double?
    var vo2Max: Double?
    var cardioRecovery: Double?
    var nutrients: Nutrients?
    var runningStrideLength: Double?
    var swimmingDistanceYards: Double?
    var swimmingStrokes: Double?

    var id: String { date }
}

struct FoodEntry: Decodable, Identifiable {
    var id: String
    var time: String?
    var meal: String?
    var food: String?
    var portion: String?
    var calories: Double?
    var protein: Double?
    var carbs: Double?
    var fat: Double?
    var fiber: Double?
    var notes: String?
    var source: String?
    var aiFilled: Bool?
    var nutrients: Nutrients?
    /// Where it was eaten, when a fix was taken at log time and the place has a name.
    var place: String?

    /// Must mean the same thing the website's queue means, or the prompt outlives the
    /// work: an entry the model has already been asked about is finished even if it
    /// could not supply every field.
    var needsNutrition: Bool {
        if aiFilled == true { return false }
        if calories == nil || protein == nil || carbs == nil || fat == nil || fiber == nil { return true }
        return (nutrients?.isEmpty ?? true)
    }
}

struct Workout: Decodable, Identifiable {
    /// The HealthKit workout's own UUID, when this came from a real logged session.
    /// Falls back to a composed key only for the (now rare) shape that has none, so
    /// `id` is never empty.
    var workoutId: String?
    var time: String?
    var endTime: String?
    var activity: String?
    /// The wire name behind `activity` ("strengthTraining", not "Strength training") —
    /// what picks the SF Symbol, so a rename of the display label can never silently
    /// break the icon lookup.
    var activityKey: String?
    var durationMinutes: Double?
    var activeCalories: Double?
    var distanceMiles: Double?
    var swimmingDistanceYards: Double?
    var strokeCount: Double?
    var stepCount: Double?
    var dataQuality: String?
    var id: String { workoutId ?? (activity ?? "workout") + String(distanceMiles ?? 0) + String(stepCount ?? 0) }

    enum CodingKeys: String, CodingKey {
        case workoutId = "id", time, endTime, activity, activityKey, durationMinutes, activeCalories,
             distanceMiles, swimmingDistanceYards, strokeCount, stepCount, dataQuality
    }

    /// Apple's own Fitness-app glyph for this activity, where Fuel knows one.
    var icon: String {
        switch activityKey {
        case "running": return "figure.run"
        case "walking": return "figure.walk"
        case "cycling": return "figure.outdoor.cycle"
        case "swimming": return "figure.pool.swim"
        case "strengthTraining": return "figure.strengthtraining.traditional"
        case "functionalStrength": return "figure.strengthtraining.functional"
        case "hiit": return "figure.highintensity.intervaltraining"
        case "yoga": return "figure.yoga"
        case "pilates": return "figure.pilates"
        case "elliptical": return "figure.elliptical"
        case "rowing": return "figure.rower"
        case "stairClimbing": return "figure.stairs"
        case "hiking": return "figure.hiking"
        case "tennis": return "figure.tennis"
        case "basketball": return "figure.basketball"
        case "soccer": return "figure.soccer"
        case "coreTraining": return "figure.core.training"
        case "flexibility": return "figure.flexibility"
        case "cooldown": return "figure.cooldown"
        case "mindAndBody": return "figure.mind.and.body"
        case "dance": return "figure.dance"
        case "badminton": return "figure.badminton"
        case "pickleball": return "figure.pickleball"
        default: return "figure.mixed.cardio"
        }
    }
}

struct Supplement: Decodable, Identifiable {
    var time: String?
    var name: String?
    var dose: String?
    var id: String { (name ?? "") + (time ?? "") }
}

struct RecipeNutrition: Decodable {
    var calories: Double?
    var protein: Double?
    var carbs: Double?
    var fat: Double?
    var fiber: Double?
    var nutrients: Nutrients?
}

/// A meal the user saved themselves, as opposed to the shared recipe bank below. Stored
/// with its items rather than as one summed row, so logging it again reproduces the
/// diary entries it was built from.
struct SavedMeal: Decodable, Identifiable, Hashable {
    struct Item: Codable, Hashable {
        var description: String
        var portion: String?
        var calories: Double?
        var protein: Double?
        var carbs: Double?
        var fat: Double?
        var fiber: Double?

        var payload: [String: Any] {
            var out: [String: Any] = ["description": description]
            if let portion, !portion.isEmpty { out["portion"] = portion }
            if let calories { out["calories"] = calories }
            if let protein { out["protein"] = protein }
            if let carbs { out["carbs"] = carbs }
            if let fat { out["fat"] = fat }
            if let fiber { out["fiber"] = fiber }
            return out
        }
    }
    struct Totals: Decodable, Hashable {
        var calories: Double?
        var protein: Double?
        var carbs: Double?
        var fat: Double?
        var fiber: Double?
    }

    var id: String
    var name: String
    var meal: String?
    var items: [Item]
    var nutrition: Totals?
    var logCount: Int?
    var lastLoggedAt: String?
}

/// Something the user has logged before, ready to log again.
struct FoodHistoryItem: Decodable, Identifiable, Hashable {
    var description: String
    var portion: String?
    var meal: String?
    var calories: Double?
    var protein: Double?
    var carbs: Double?
    var fat: Double?
    var fiber: Double?
    var lastLoggedAt: String?

    var id: String { description.lowercased() }
}

/// The shared, global recipe bank — same rows the website's /recipes.html renders,
/// normalized server-side by recipes.js's normalizeRecipe().
struct Recipe: Decodable, Identifiable {
    var id: String?
    var name: String?
    var category: String?
    var serving: String?
    var ingredients: [String]?
    var instructions: [String]?
    var nutrition: RecipeNutrition?
    var source: String?
    var nutritionEstimated: Bool?
    var hasNutrition: Bool?
}

struct GoalRange: Decodable {
    var minimum: Double?
    var target: Double?
    var maximum: Double?
}

struct Goals: Decodable {
    var calories: GoalRange?
    var calorieBalancePercent: GoalRange?
    var protein: GoalRange?
    var carbs: GoalRange?
    var fat: GoalRange?
    var fiber: GoalRange?
    var move: GoalRange?
    var exercise: GoalRange?
    var stand: GoalRange?
    var steps: GoalRange?
    var sleepHours: GoalRange?
}

/// The flat shape /api/goals reads and writes — the same keys the website's editor uses.
struct GoalValues: Codable {
    var calorieBalancePercent: Double?
    var protein: Double?
    var carbs: Double?
    var fat: Double?
    var fiber: Double?
    var move: Double?
    var exercise: Double?
    var stand: Double?
    var steps: Double?
    var sleepHours: Double?
    var calories: Double?
    /// 0 (the default) means off. See goals.js: a real default doesn't make sense for
    /// a floor most users shouldn't have applied at all.
    var restingCaloriesFloor: Double?
}

/// One editable past day, from ?fuel_route=daily-history.
struct HistoryDay: Decodable, Identifiable {
    var date: String
    var totalExpenditure: Double?
    var restingEnergy: Double?
    var activeEnergy: Double?
    var consumed: Double?
    var consumedLogged: Double?
    var consumedOverridden: Bool?
    var id: String { date }
}

/// Which sections appear, in what order, and which energy boxes are shown.
struct DashboardLayout: Codable {
    var order: [String]
    var hidden: [String]
    var energyBoxes: [String]
    var charts: [String]

    static let allSections = ["nutrition", "detailedNutrition", "foodConsumed",
                              "fitness", "workouts", "steps", "vitals", "recovery"]
    static let allEnergyBoxes = ["totalBurned", "consumed", "active", "resting", "deficit", "rolling24"]
    static let allCharts = ["intraday", "components"]
    static let `default` = DashboardLayout(order: allSections, hidden: [], energyBoxes: allEnergyBoxes, charts: allCharts)

    // `charts` shipped after this type did. A custom decode keeps an older cached
    // response — or a server not yet redeployed with the field — from failing the
    // whole decode; it just falls back to showing both charts, same as the server's
    // own "key absent means defaults" rule.
    init(order: [String], hidden: [String], energyBoxes: [String], charts: [String]) {
        self.order = order; self.hidden = hidden; self.energyBoxes = energyBoxes; self.charts = charts
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        order = try c.decode([String].self, forKey: .order)
        hidden = try c.decode([String].self, forKey: .hidden)
        energyBoxes = try c.decode([String].self, forKey: .energyBoxes)
        charts = try c.decodeIfPresent([String].self, forKey: .charts) ?? Self.allCharts
    }
}

struct IntradayEnergy: Decodable {
    struct Expenditure: Decodable { var collectedAt: String; var totalExpenditure: Double? }
    struct Consumed: Decodable { var collectedAt: String; var caloriesConsumed: Double? }
    var date: String?
    var expenditure: [Expenditure]
    var consumed: [Consumed]
}

struct Rolling24h: Decodable {
    var consumed: Double?
    var burned: Double?
    var balance: Double?
    var foodCount: Int?
}

struct Coverage: Decodable {
    var days: Int?
    var foodEntries: Int?
}

// MARK: - Places

struct Place: Decodable, Identifiable {
    var id: String
    var label: String?
    var suggestedLabel: String?
    var suggestedDetail: String?
    var identified: Bool
    var latitude: Double
    var longitude: Double
    var samples: Int
    var likelyHome: Bool
}

/// One half-hour slot in the 24-hour day, and which place dominated it.
struct PlaceBucket: Decodable {
    var index: Int
    var startMinute: Int
    var placeId: String?
    var samples: Int
    var share: Double
}

struct PlaceHeatmap: Decodable {
    var places: [Place]
    var buckets: [PlaceBucket]
    var bucketsPerDay: Int
    var windowDays: Int
    var totalSamples: Int
    var daysCovered: Int
    var firstSampleAt: String?
}

struct PlaceIdentifyResult: Decodable {
    var id: String?
    var suggestedLabel: String?
    var suggestedDetail: String?
    var identified: Bool?
}

// MARK: - Client

enum FuelClientError: LocalizedError {
    case notConfigured
    case unauthorized
    case http(Int, String)

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "Add your Fuel token in Settings."
        case .unauthorized: return "That token was rejected. Check it in Settings."
        case .http(let code, let message): return "Fuel responded \(code): \(message)"
        }
    }
}

struct FuelClient {
    var baseURL: URL
    var token: String

    static let defaultBaseURL = "https://fuel.rishib.com"

    init(baseURL: String, token: String) throws {
        guard let url = URL(string: baseURL), url.host != nil else { throw FuelClientError.notConfigured }
        self.baseURL = url
        self.token = token
    }

    private func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw FuelClientError.notConfigured }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if !token.isEmpty { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        request.timeoutInterval = 30
        return request
    }

    private func send(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw FuelClientError.http(0, "no response") }
        if http.statusCode == 401 { throw FuelClientError.unauthorized }
        guard (200...299).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
                ?? String(data: data.prefix(160), encoding: .utf8) ?? "unknown error"
            throw FuelClientError.http(http.statusCode, message)
        }
        return data
    }

    func dashboard() async throws -> Dashboard {
        let data = try await send(try request("/api/mlog"))
        return try JSONDecoder().decode(Dashboard.self, from: data)
    }

    @discardableResult
    /// `at` tags the entry with where it was eaten. The coordinate is resolved into one
    /// of the user's own places server-side, so what is stored is a place rather than a
    /// track of raw positions.
    func logFood(description: String, meal: String?, portion: String?,
                 calories: Double?, protein: Double?, carbs: Double?, fat: Double?, fiber: Double?,
                 notes: String? = nil, occurredAt: Date? = nil, at fix: MealFix? = nil) async throws -> Data {
        var body: [String: Any] = ["description": description, "source": "Fuel iOS"]
        if let fix { fix.apply(to: &body) }
        if let meal, !meal.isEmpty { body["meal"] = meal }
        if let portion, !portion.isEmpty { body["portion"] = portion }
        if let calories { body["calories"] = calories }
        if let protein { body["protein"] = protein }
        if let carbs { body["carbs"] = carbs }
        if let fat { body["fat"] = fat }
        if let fiber { body["fiber"] = fiber }
        if let notes, !notes.isEmpty { body["notes"] = notes }
        if let occurredAt { body["occurredAt"] = ISO8601DateFormatter().string(from: occurredAt) }
        return try await send(try request("/api/mlog", method: "POST", body: body))
    }

    @discardableResult
    func updateFood(id: String, description: String, meal: String?, portion: String?,
                    calories: Double?, protein: Double?, carbs: Double?, fat: Double?, fiber: Double?) async throws -> Data {
        var body: [String: Any] = ["entryId": id, "description": description]
        body["meal"] = meal ?? ""
        body["portion"] = portion ?? ""
        if let calories { body["calories"] = calories }
        if let protein { body["protein"] = protein }
        if let carbs { body["carbs"] = carbs }
        if let fat { body["fat"] = fat }
        if let fiber { body["fiber"] = fiber }
        return try await send(try request("/api/mlog", method: "PUT", body: body))
    }

    // MARK: - Saved meals and history

    func savedMeals() async throws -> [SavedMeal] {
        struct Response: Decodable { var meals: [SavedMeal] }
        let data = try await send(try request("/api/mlog?integration=meals"))
        return try JSONDecoder().decode(Response.self, from: data).meals
    }

    @discardableResult
    func createMeal(name: String, meal: String?, items: [SavedMeal.Item]) async throws -> SavedMeal {
        struct Response: Decodable { var meal: SavedMeal }
        var body: [String: Any] = ["name": name, "items": items.map(\.payload)]
        if let meal, !meal.isEmpty { body["meal"] = meal }
        let data = try await send(try request("/api/mlog?integration=meals", method: "POST", body: body))
        return try JSONDecoder().decode(Response.self, from: data).meal
    }

    /// Turns entries already in the diary into a saved meal. The nutrition is read from
    /// those entries server-side rather than sent, so the meal always matches what was
    /// actually eaten.
    @discardableResult
    func createMeal(name: String?, fromEntryIDs ids: [String]) async throws -> SavedMeal {
        struct Response: Decodable { var meal: SavedMeal }
        var body: [String: Any] = ["entryIds": ids]
        if let name, !name.isEmpty { body["name"] = name }
        let data = try await send(try request("/api/mlog?integration=meals", method: "POST", body: body))
        return try JSONDecoder().decode(Response.self, from: data).meal
    }

    func logSavedMeal(id: String, at fix: MealFix? = nil) async throws {
        var body: [String: Any] = ["action": "log", "id": id]
        if let fix { fix.apply(to: &body) }
        _ = try await send(try request("/api/mlog?integration=meals", method: "POST", body: body))
    }

    func deleteSavedMeal(id: String) async throws {
        _ = try await send(try request("/api/mlog?integration=meals&id=\(id)", method: "DELETE"))
    }

    func foodHistory(limit: Int = 100) async throws -> [FoodHistoryItem] {
        struct Response: Decodable { var items: [FoodHistoryItem] }
        let data = try await send(try request("/api/mlog?integration=food-history&limit=\(limit)"))
        return try JSONDecoder().decode(Response.self, from: data).items
    }

    /// Food, workouts and supplements for one day other than today — that day's summary
    /// is already on hand in `Dashboard.trends`, so this fetches only what isn't.
    func dayDetail(date: String) async throws -> DayDetail {
        let data = try await send(try request("/api/mlog?integration=day-detail&date=\(date)"))
        return try JSONDecoder().decode(DayDetail.self, from: data)
    }

    func deleteFood(id: String) async throws {
        _ = try await send(try request("/api/mlog", method: "DELETE", body: ["entryId": id]))
    }

    /// Places heatmap — the same payload the web app's Places page renders.
    func places(days: Int = 30) async throws -> PlaceHeatmap {
        try JSONDecoder().decode(PlaceHeatmap.self, from: try await send(try request("/api/mlog?fuel_route=places&days=\(days)")))
    }

    /// One location fix, filed under the nearest known place server-side. Mirrors the
    /// website's own per-page-load capture — quiet, no error surfaced on failure.
    @discardableResult
    func recordLocation(latitude: Double, longitude: Double, accuracy: Double?) async throws -> Data {
        var body: [String: Any] = ["latitude": latitude, "longitude": longitude]
        if let accuracy { body["accuracy"] = accuracy }
        return try await send(try request("/api/mlog?fuel_route=places", method: "POST", body: body))
    }

    /// Looks up a name for one unidentified place. One at a time — the lookup is
    /// rate-limited upstream, so the caller walks its unidentified places itself.
    func identifyPlace(_ placeId: String) async throws -> PlaceIdentifyResult {
        try JSONDecoder().decode(PlaceIdentifyResult.self, from: try await send(try request(
            "/api/mlog?fuel_route=places", method: "POST", body: ["action": "identify", "placeId": placeId])))
    }

    func renamePlace(_ placeId: String, label: String) async throws {
        _ = try await send(try request("/api/mlog?fuel_route=places", method: "PUT", body: ["placeId": placeId, "label": label]))
    }

    /// Deletes every stored fix and place for this account. Irreversible, exactly as
    /// on the website.
    func clearPlaces() async throws {
        _ = try await send(try request("/api/mlog?fuel_route=places", method: "DELETE"))
    }

    func goals() async throws -> GoalValues {
        try JSONDecoder().decode(GoalValues.self, from: try await send(try request("/api/goals")))
    }

    func saveGoals(_ goals: GoalValues) async throws {
        let data = try JSONEncoder().encode(goals)
        let body = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        _ = try await send(try request("/api/goals", method: "PUT", body: body))
    }

    func history(days: Int = 30) async throws -> [HistoryDay] {
        struct Response: Decodable { var days: [HistoryDay] }
        let data = try await send(try request("/api/mlog?fuel_route=daily-history&days=\(days)"))
        return try JSONDecoder().decode(Response.self, from: data).days
    }

    /// Overrides one day's energy and intake, exactly as the website's history editor
    /// does. Sending null for a field clears the override rather than zeroing it.
    ///
    /// The server reads body.values, not the bare fields — same shape the browser sends.
    func saveHistory(date: String, totalExpenditure: Double?, restingEnergy: Double?,
                     activeEnergy: Double?, consumed: Double?) async throws {
        let values: [String: Any] = [
            "totalExpenditure": totalExpenditure ?? NSNull(),
            "restingEnergy": restingEnergy ?? NSNull(),
            "activeEnergy": activeEnergy ?? NSNull(),
            "consumed": consumed ?? NSNull(),
        ]
        _ = try await send(try request("/api/mlog?fuel_route=daily-history", method: "PUT",
                                       body: ["date": date, "values": values]))
    }

    func layout() async throws -> DashboardLayout {
        struct Response: Decodable { var layout: DashboardLayout }
        let data = try await send(try request("/api/mlog?fuel_route=dashboard-layout"))
        return try JSONDecoder().decode(Response.self, from: data).layout
    }

    /// The server reads body.layout, not the bare object. Sending it unwrapped answers
    /// 200 and saves the defaults, which looks like success and is not.
    func saveLayout(_ layout: DashboardLayout) async throws {
        let data = try JSONEncoder().encode(layout)
        let inner = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        _ = try await send(try request("/api/mlog?fuel_route=dashboard-layout", method: "PUT",
                                       body: ["layout": inner]))
    }

    /// Adds a recipe to the shared bank — the same saveRecipe() the MCP tools call, now
    /// reachable from the app so the Coach can add one on request.
    func createRecipe(name: String, ingredients: [String], servings: Double?,
                      nutrition: EstimatedNutrition?) async throws {
        var body: [String: Any] = ["name": name, "ingredients": ingredients]
        if let servings { body["servings"] = servings }
        if let nutrition {
            if let v = nutrition.calories { body["calories"] = v }
            if let v = nutrition.protein { body["protein"] = v }
            if let v = nutrition.carbs { body["carbs"] = v }
            if let v = nutrition.fat { body["fat"] = v }
            if let v = nutrition.fiber { body["fiber"] = v }
        }
        _ = try await send(try request("/api/mlog?fuel_route=save-recipe", method: "POST", body: body))
    }

    func userContext() async throws -> String {
        let data = try await send(try request("/api/mlog?fuel_route=user-context"))
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return object?["context"] as? String ?? ""
    }

    /// Replaces the complete stored context, exactly as the website's editor does.
    @discardableResult
    func saveUserContext(_ context: String) async throws -> String {
        let data = try await send(try request("/api/mlog?fuel_route=user-context", method: "PUT", body: ["context": context]))
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return object?["context"] as? String ?? context
    }

    // MARK: - Recipes

    struct RecipeLogOutcome {
        var ok: Bool
        var needsNutrition: Bool
        var recipeId: String?
    }

    /// Logs one serving of a recipe to today. The server reads nutrition from the
    /// recipe bank, so a 409 with needsNutrition means it refused rather than logging
    /// a zero-calorie entry — the caller should estimate, then retry once.
    func logRecipe(recipeId: String, servings: Double = 1) async throws -> RecipeLogOutcome {
        let req = try request("/api/mlog?fuel_route=log-recipe", method: "POST",
                              body: ["recipeId": recipeId, "servings": servings])
        let (body, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else { throw FuelClientError.http(0, "no response") }
        let payload = (try? JSONSerialization.jsonObject(with: body) as? [String: Any]) ?? [:]
        if http.statusCode == 409, payload["needsNutrition"] as? Bool == true {
            return RecipeLogOutcome(ok: false, needsNutrition: true, recipeId: payload["recipeId"] as? String ?? recipeId)
        }
        if http.statusCode == 401 { throw FuelClientError.unauthorized }
        guard (200...299).contains(http.statusCode) else {
            throw FuelClientError.http(http.statusCode, payload["error"] as? String ?? "unknown error")
        }
        return RecipeLogOutcome(ok: true, needsNutrition: false, recipeId: recipeId)
    }

    /// Recipes needing a nutrition breakdown — the same list the website's backfill
    /// banner reads from, so the app can walk it and estimate each one on-device.
    func recipesNeedingNutrition() async throws -> [(id: String, name: String)] {
        struct Entry: Decodable { var id: String; var name: String }
        struct Response: Decodable { var recipes: [Entry] }
        let data = try await send(try request("/api/mlog?fuel_route=recipe-nutrition"))
        return try JSONDecoder().decode(Response.self, from: data).recipes.map { ($0.id, $0.name) }
    }

    /// Persists a nutrition estimate this phone already computed on-device. The server
    /// only writes it in if the recipe is still missing nutrition (never overwrites a
    /// contributor's own numbers or another estimate), and never calls Gemini itself —
    /// this route is pure storage, unlike the website's POST to the same path.
    @discardableResult
    func saveRecipeNutrition(recipeId: String, nutrition: EstimatedNutrition) async throws -> Recipe {
        var body: [String: Any] = ["recipeId": recipeId]
        if let v = nutrition.calories { body["calories"] = v }
        if let v = nutrition.protein { body["protein"] = v }
        if let v = nutrition.carbs { body["carbs"] = v }
        if let v = nutrition.fat { body["fat"] = v }
        if let v = nutrition.fiber { body["fiber"] = v }
        struct Response: Decodable { var recipe: Recipe }
        let data = try await send(try request("/api/mlog?fuel_route=recipe-nutrition", method: "PUT", body: body))
        return try JSONDecoder().decode(Response.self, from: data).recipe
    }
}
