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
    var trends: [DaySummary]
    var recipes: [Recipe]?
    var intradayEnergy: IntradayEnergy?
    var rolling24h: Rolling24h?
    var coverage: Coverage?
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
    var activity: String?
    var distanceMiles: Double?
    var swimmingDistanceYards: Double?
    var strokeCount: Double?
    var stepCount: Double?
    var dataQuality: String?
    var id: String { (activity ?? "workout") + String(distanceMiles ?? 0) + String(stepCount ?? 0) }
}

struct Supplement: Decodable, Identifiable {
    var time: String?
    var name: String?
    var dose: String?
    var id: String { (name ?? "") + (time ?? "") }
}

struct Recipe: Decodable, Identifiable {
    var id: String?
    var name: String?
    var calories: Double?
    var protein: Double?
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

    static let allSections = ["nutrition", "detailedNutrition", "foodConsumed",
                              "fitness", "workouts", "steps", "vitals", "recovery"]
    static let allEnergyBoxes = ["totalBurned", "consumed", "active", "resting", "deficit", "rolling24"]
    static let `default` = DashboardLayout(order: allSections, hidden: [], energyBoxes: allEnergyBoxes)
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
    func logFood(description: String, meal: String?, portion: String?,
                 calories: Double?, protein: Double?, carbs: Double?, fat: Double?, fiber: Double?,
                 notes: String? = nil, occurredAt: Date? = nil) async throws -> Data {
        var body: [String: Any] = ["description": description, "source": "Fuel iOS"]
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

    func deleteFood(id: String) async throws {
        _ = try await send(try request("/api/mlog", method: "DELETE", body: ["entryId": id]))
    }

    /// Places heatmap — the same payload the web app's Places page renders.
    func places(days: Int = 30) async throws -> Data {
        try await send(try request("/api/mlog?fuel_route=places&days=\(days)"))
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

    func userContext() async throws -> String {
        let data = try await send(try request("/api/mlog?fuel_route=user-context"))
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return object?["context"] as? String ?? ""
    }
}
