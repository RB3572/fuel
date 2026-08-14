import Foundation

// The wire format for /api/health/sync/v1 and the client that speaks it.
// Mirrors api/_lib/health-sync.js exactly — that file is the contract's other half.
//
// Nothing here is Fuel-specific beyond the default URL: any server implementing this
// contract is a valid destination, and the file export writes these same payloads.

struct SyncPayload: Encodable {
    var syncVersion = 1
    var fullSync = false
    var batch: Batch?
    var device: DeviceInfo
    var anchors: [String: String] = [:]
    var tables = Tables()
    var deleted = Deleted()
    var snapshot: Snapshot?

    struct Batch: Encodable { var index: Int; var count: Int }

    struct DeviceInfo: Encodable {
        var model: String
        var iosVersion: String
        var timezone: String
        var lastSync: String?
    }

    struct Tables: Encodable {
        var dailyTotals: [DailyTotal] = []
        var quantitySamples: [QuantitySample] = []
        var categorySamples: [CategorySample] = []
        var workoutSamples: [WorkoutSample] = []
        var clinicalRecords: [ClinicalRecord] = []
        var isEmpty: Bool {
            dailyTotals.isEmpty && quantitySamples.isEmpty && categorySamples.isEmpty
                && workoutSamples.isEmpty && clinicalRecords.isEmpty
        }
        var sampleCount: Int {
            quantitySamples.count + categorySamples.count + workoutSamples.count + clinicalRecords.count
        }
    }

    struct Deleted: Encodable {
        var quantitySamples: [String] = []
        var categorySamples: [String] = []
        var workouts: [String] = []
        var isEmpty: Bool { quantitySamples.isEmpty && categorySamples.isEmpty && workouts.isEmpty }
    }

    struct Snapshot: Encodable {
        var date: String
        var activeEnergy: Double?
        var restingEnergy: Double?
        var totalExpenditure: Double?
    }
}

struct QuantitySample: Encodable {
    var uuid: String
    var type: String
    var value: Double
    var unit: String
    var start: String
    var end: String
    var source: String?
    var device: String?
}

struct CategorySample: Encodable {
    var uuid: String
    var type: String
    var value: Int
    var valueName: String?
    var start: String
    var end: String
    var source: String?
    var device: String?
}

struct WorkoutSample: Encodable {
    var uuid: String
    var activityType: String
    var start: String
    var end: String
    var duration: Double?
    var activeEnergy: Double?
    var distance: Double?
    var elevation: Double?
    var averageHeartRate: Double?
    var source: String?
    var route: [[Double]]?
}

struct ClinicalRecord: Encodable {
    var uuid: String
    var type: String
    var fhir: [String: String]
}

struct DailyTotal: Encodable {
    var date: String
    var partialDay: Bool
    var activeEnergy: Double?
    var restingEnergy: Double?
    var totalExpenditure: Double?
    var exerciseMinutes: Double?
    var steps: Double?
    var walkingRunningDistanceMi: Double?
    var swimmingDistanceYd: Double?
    var restingHeartRate: Double?
    var hrv: Double?
    var vo2Max: Double?
    var sleepHours: Double?
    var respiratoryRate: Double?
    var bloodOxygen: Double?
    var standMinutes: Double?
    var walkingHeartRateAverage: Double?
    var cyclingDistanceMi: Double?
    var flightsClimbed: Double?
    var swimmingStrokes: Double?
    var runningStrideLength: Double?
    var cardioRecovery: Double?
    /// Everything added after the first eighteen metrics, one value per day, keyed by
    /// name. A dictionary rather than twenty more properties and twenty more columns:
    /// these are summaries, the set will keep growing, and a day with none of them
    /// should cost nothing. See SyncEngine.extraMetrics and the `extras` jsonb column.
    var extras: [String: Double]?
    /// The same column, for the few things about a day that are not a number — so far
    /// just the night's hypnogram, which is a run of stages and has to stay in order.
    var extraText: [String: String]?
}

struct SyncResponse: Decodable {
    struct Stored: Decodable {
        var quantitySamples: Int
        var categorySamples: Int
        var workouts: Int
        var clinicalRecords: Int
        var dailyTotals: Int
        var deleted: Int
    }
    var ok: Bool
    var stored: Stored
}

struct SyncState: Decodable {
    var syncVersion: Int
    var maxSamplesPerRequest: Int
    var anchors: [String: String]
}

enum FuelAPIError: LocalizedError {
    case notConfigured
    case http(Int, String)

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "That destination URL is not valid."
        case .http(let status, let message): return "Server responded \(status): \(message)"
        }
    }
}

struct FuelAPI {
    let endpoint: URL
    let token: String

    init(endpoint: String, token: String) throws {
        // A token is required for Fuel but optional in general: a self-hosted endpoint
        // may authenticate some other way, or not at all on a private network.
        guard let url = URL(string: endpoint), url.scheme != nil, url.host != nil else {
            throw FuelAPIError.notConfigured
        }
        self.endpoint = url
        self.token = token
    }

    private func authorized(_ request: inout URLRequest) {
        guard !token.isEmpty else { return }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    /// GET — anchors and limits, so a fresh install resumes instead of re-uploading.
    func state() async throws -> SyncState {
        var request = URLRequest(url: endpoint)
        authorized(&request)
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.check(response, data)
        return try JSONDecoder().decode(SyncState.self, from: data)
    }

    /// POST one batch. The server is idempotent, so retrying a timeout is always safe.
    func upload(_ payload: SyncPayload) async throws -> SyncResponse {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        authorized(&request)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 120
        request.httpBody = try JSONEncoder().encode(payload)
        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.check(response, data)
        return try JSONDecoder().decode(SyncResponse.self, from: data)
    }

    private static func check(_ response: URLResponse, _ data: Data) throws {
        guard let http = response as? HTTPURLResponse else { throw FuelAPIError.http(0, "no response") }
        guard (200...299).contains(http.statusCode) else {
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
                ?? String(data: data.prefix(200), encoding: .utf8) ?? "unknown error"
            throw FuelAPIError.http(http.statusCode, message)
        }
    }
}
