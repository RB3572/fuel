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

    /// What the AI fill queue considers outstanding: no macros yet, and never filled.
    var needsNutrition: Bool {
        (aiFilled != true) && (calories == nil || protein == nil || carbs == nil || fat == nil)
    }
}

struct Workout: Decodable, Identifiable {
    var type: String?
    var minutes: Double?
    var calories: Double?
    var id: String { (type ?? "workout") + String(minutes ?? 0) }
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
    var protein: GoalRange?
    var carbs: GoalRange?
    var fat: GoalRange?
    var fiber: GoalRange?
    var steps: GoalRange?
    var exercise: GoalRange?
    var sleepHours: GoalRange?
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

    func userContext() async throws -> String {
        let data = try await send(try request("/api/mlog?fuel_route=user-context"))
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        return object?["context"] as? String ?? ""
    }
}
