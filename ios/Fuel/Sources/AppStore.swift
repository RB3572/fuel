import Foundation
import SwiftUI
import HealthKit

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
}

@MainActor
@Observable
final class AppStore {
    static let shared = AppStore()

    var dashboard: Dashboard?
    var loading = false
    var error: String?
    var context: String = ""

    /// The Coach transcript. Kept in memory for the session and replayed into the model
    /// as conversation history, so follow-ups like "what about carbs?" make sense.
    var messages: [ChatMessage] = []
    var coachThinking = false

    var logging = false
    var lastLogged: String?

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
    /// switching to a self-hosted Fuel moves both halves together.
    private func syncEndpointFromBase() {
        SyncStore.shared.endpoint = baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            + "/api/health/sync/v1"
        // The sync engine authenticates with the same OAuth access token.
        Task { SyncStore.shared.token = await auth.accessToken() ?? "" }
    }

    private func client() async throws -> FuelClient {
        guard let token = await auth.accessToken() else { throw FuelClientError.notConfigured }
        SyncStore.shared.token = token
        return try FuelClient(baseURL: baseURL, token: token)
    }

    // MARK: - Loading

    func load() async {
        guard isSignedIn else { return }
        loading = true
        defer { loading = false }
        do {
            dashboard = try await client().dashboard()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func loadContext() async {
        guard isSignedIn, context.isEmpty else { return }
        context = (try? await client().userContext()) ?? ""
    }

    // MARK: - Food

    func logFood(description: String, meal: String?, portion: String?, nutrition: EstimatedNutrition?) async {
        do {
            try await client().logFood(description: description, meal: meal, portion: portion,
                                       calories: nutrition?.calories, protein: nutrition?.protein,
                                       carbs: nutrition?.carbs, fat: nutrition?.fat, fiber: nutrition?.fiber)
            await load()
            await announceLogged(description, nutrition: nutrition, photo: nil)
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// The camera path: identify on device, log it, and let the coach react — the same
    /// rhythm as the website, where logging something prompts a plan for the rest of
    /// the day.
    func logPhoto(_ photo: Data, note: String?) async {
        logging = true
        defer { logging = false }
        do {
            let identified = try await OnDeviceAI.shared.identifyMeal(photo: photo, note: note)
            try await client().logFood(description: identified.name, meal: identified.meal,
                                       portion: identified.portion,
                                       calories: identified.nutrition.calories,
                                       protein: identified.nutrition.protein,
                                       carbs: identified.nutrition.carbs,
                                       fat: identified.nutrition.fat,
                                       fiber: identified.nutrition.fiber,
                                       notes: note)
            lastLogged = identified.name
            await load()
            await announceLogged(identified.name, nutrition: identified.nutrition, photo: photo)
            // Clear the confirmation after a beat so the camera goes back to being a camera.
            try? await Task.sleep(for: .seconds(3))
            lastLogged = nil
        } catch {
            self.error = error.localizedDescription
            lastLogged = nil
        }
    }

    /// Drops the meal into the Coach transcript and asks for a plan for what's left of
    /// the day, given everything already eaten and burned.
    private func announceLogged(_ food: String, nutrition: EstimatedNutrition?, photo: Data?) async {
        let macros = nutrition.map {
            " (\(Format.kcal($0.calories)) kcal, \(Format.number($0.protein)) g protein)"
        } ?? ""
        messages.append(ChatMessage(role: .user, text: "Logged \(food)\(macros)", loggedFood: food, photo: photo))
        guard let summary = dashboard?.today.summary, OnDeviceAI.shared.availability.isReady else { return }
        coachThinking = true
        defer { coachThinking = false }
        do {
            let plan = try await OnDeviceAI.shared.planRestOfDay(
                justLogged: food, summary: summary, goals: dashboard?.goals, context: context)
            messages.append(ChatMessage(role: .coach, text: plan))
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
        // A placeholder the stream fills in, so text appears as it generates.
        let index = messages.count
        messages.append(ChatMessage(role: .coach, text: ""))
        do {
            let stream = OnDeviceAI.shared.ask(question, summary: summary,
                                               dashboard: dashboard, history: messages,
                                               context: context)
            for try await partial in stream {
                if messages.indices.contains(index) { messages[index].text = partial.content }
            }
        } catch {
            if messages.indices.contains(index) { messages[index].text = error.localizedDescription }
        }
    }

    // MARK: - Health

    func requestHealthAccess() async {
        do {
            try await SyncEngine.shared.requestAuthorization()
            healthAuthorized = true
            UserDefaults.standard.set(true, forKey: "hkAuthorized")
            BackgroundSync.enableHealthKitDelivery()
            await syncHealth(reason: "first authorization")
        } catch {
            self.error = "Health access failed: \(error.localizedDescription)"
        }
    }

    func syncHealth(reason: String) async {
        guard isSignedIn, healthAuthorized else { return }
        SyncStore.shared.token = await auth.accessToken() ?? ""
        _ = await SyncEngine.shared.sync(reason: reason)
        await load()
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
