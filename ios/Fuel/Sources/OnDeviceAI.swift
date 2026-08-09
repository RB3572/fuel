import Foundation
import FoundationModels
import Vision

// Fuel's AI, running on the phone.
//
// The website sends food descriptions and meal-plan prompts to Gemini. That costs a
// round trip, depends on someone else's uptime, and has spent most of this project's
// life rationed by a free-tier quota — the nutrient fill broke repeatedly for exactly
// that reason. Apple's on-device model has none of those properties: no key, no quota,
// no network, and the food you eat never leaves the phone.
//
// The tradeoff is honest: a ~3B on-device model is weaker than Gemini at obscure foods.
// It is asked only for structured estimates it can actually do, and every field is
// optional so a shrug is representable.

// MARK: - Generated types
//
// @Generable makes the model emit these directly under a constrained decoder, so the
// output is a typed value rather than JSON that might not parse. The whole class of
// "the model returned prose around the JSON" bug the Gemini path kept hitting cannot
// occur here.

@Generable
struct EstimatedNutrition {
    @Guide(description: "Total calories for the portion described, in kilocalories")
    var calories: Double?
    @Guide(description: "Grams of protein")
    var protein: Double?
    @Guide(description: "Grams of total carbohydrate")
    var carbs: Double?
    @Guide(description: "Grams of fat")
    var fat: Double?
    @Guide(description: "Grams of dietary fiber")
    var fiber: Double?
}

@Generable
struct IdentifiedMeal {
    @Guide(description: "Short name of the food, e.g. 'Chicken burrito bowl'")
    var name: String
    @Guide(description: "Portion as a person would say it, e.g. '1 bowl' or '2 slices'")
    var portion: String?
    @Guide(description: "One of: breakfast, lunch, dinner, snack")
    var meal: String?
    var nutrition: EstimatedNutrition
}

@Generable
struct DailyInsight {
    @Guide(description: "One sentence on how the day is going, grounded only in the numbers given")
    var summary: String
    @Guide(description: "One concrete, actionable suggestion for the rest of the day")
    var suggestion: String
}

// MARK: - Engine

@MainActor
@Observable
final class OnDeviceAI {
    static let shared = OnDeviceAI()

    enum Availability {
        case ready
        case unavailable(String)

        var isReady: Bool { if case .ready = self { return true }; return false }
    }

    private(set) var availability: Availability = .unavailable("Checking…")

    private let model = SystemLanguageModel.default

    init() { refreshAvailability() }

    func refreshAvailability() {
        switch model.availability {
        case .available:
            availability = .ready
        case .unavailable(.deviceNotEligible):
            availability = .unavailable("This device doesn't support Apple Intelligence.")
        case .unavailable(.appleIntelligenceNotEnabled):
            availability = .unavailable("Turn on Apple Intelligence in Settings to use Fuel AI.")
        case .unavailable(.modelNotReady):
            availability = .unavailable("The on-device model is still downloading.")
        case .unavailable(let other):
            availability = .unavailable("On-device model unavailable (\(String(describing: other))).")
        @unknown default:
            availability = .unavailable("On-device model unavailable.")
        }
    }

    private func session(_ instructions: String) -> LanguageModelSession {
        LanguageModelSession(model: model, instructions: instructions)
    }

    private static let nutritionist = """
    You estimate nutrition for foods people log in a fitness app. Give your best numeric \
    estimate for a typical preparation of the described food at the described portion. \
    Use kilocalories and grams. If a field genuinely cannot be estimated, leave it empty \
    rather than guessing wildly. Do not explain your reasoning.
    """

    /// Fills macros for one logged food. This is the on-device replacement for
    /// /api/mlog?fuel_route=food-nutrition.
    func estimateNutrition(food: String, portion: String?) async throws -> EstimatedNutrition {
        let portionText = (portion?.isEmpty == false) ? " Portion: \(portion!)." : ""
        let response = try await session(Self.nutritionist).respond(
            to: "Food: \(food).\(portionText)",
            generating: EstimatedNutrition.self
        )
        return response.content
    }

    /// Identifies a meal from a photo and estimates its nutrition — the on-device
    /// replacement for the /quicklog pipeline. The image never leaves the device.
    ///
    /// Two on-device stages, because the system language model takes text only: Vision
    /// classifies the picture, then the model reasons over the labels. Passing the
    /// labels rather than a guess keeps the model honest about what was actually seen.
    func identifyMeal(photo: Data, note: String?) async throws -> IdentifiedMeal {
        let labels = try Self.classify(photo)
        var prompt = "A food photo was classified on this device. Candidate labels, most likely first: "
            + (labels.isEmpty ? "(none recognised)" : labels.joined(separator: ", ")) + "."
        if let note, !note.isEmpty { prompt += " The person described it as: \(note)." }
        prompt += " Decide the single most likely dish, give a realistic portion, and estimate its nutrition."
        let response = try await session(Self.nutritionist).respond(to: prompt, generating: IdentifiedMeal.self)
        return response.content
    }

    /// Vision's built-in classifier, filtered to food-ish confidence. Runs locally and
    /// needs no model download.
    private static func classify(_ photo: Data) throws -> [String] {
        let request = VNClassifyImageRequest()
        try VNImageRequestHandler(data: photo, options: [:]).perform([request])
        let results = (request.results ?? [])
            .filter { $0.confidence > 0.05 }
            .sorted { $0.confidence > $1.confidence }
            .prefix(10)
        return results.map { $0.identifier.replacingOccurrences(of: "_", with: " ") }
    }

    /// A short read on the day, from the numbers already on screen. Deliberately given
    /// only the figures, so it cannot invent a trend it has not been shown.
    func dailyInsight(summary: DaySummary, goals: Goals?, context: String) async throws -> DailyInsight {
        var facts: [String] = []
        func add(_ label: String, _ value: Double?, _ unit: String) {
            if let value { facts.append("\(label): \(Int(value))\(unit)") }
        }
        add("calories consumed", summary.caloriesConsumed, " kcal")
        add("total expenditure", summary.totalExpenditure, " kcal")
        add("protein", summary.protein, " g")
        add("carbs", summary.carbs, " g")
        add("fat", summary.fat, " g")
        add("fiber", summary.fiber, " g")
        add("steps", summary.stepCount, "")
        add("exercise", summary.exerciseMinutes, " min")
        add("sleep", summary.sleepHours, " h")
        if let target = goals?.calories?.target { facts.append("calorie target: \(Int(target)) kcal") }
        if let target = goals?.protein?.target { facts.append("protein target: \(Int(target)) g") }

        let instructions = """
        You are a concise fitness coach inside a personal dashboard. Base everything only \
        on the figures provided; never invent numbers or trends. Be specific and practical. \
        Two short sentences at most in each field. Never give medical advice.
        \(context.isEmpty ? "" : "Background on this person: \(context)")
        """
        let response = try await session(instructions).respond(
            to: "Today so far — \(facts.joined(separator: ", ")). How is the day going, and what should they do next?",
            generating: DailyInsight.self
        )
        return response.content
    }

    /// Called right after something is logged: what to eat for the rest of the day,
    /// given what has already gone in. This is the website's "log something, get a
    /// plan" rhythm, running locally.
    /// Builds a plan for the rest of the day. `justLogged` names the most recent meal
    /// when there is one — passed for context only, it does not trigger this call; the
    /// caller decides when a plan is actually built (the explicit "New plan" action).
    func planRestOfDay(justLogged: String?, summary: DaySummary, goals: Goals?, context: String) async throws -> String {
        let remaining = (goals?.calories?.target).flatMap { target in
            summary.caloriesConsumed.map { target - $0 }
        }
        let proteinLeft = (goals?.protein?.target).flatMap { target in
            summary.protein.map { target - $0 }
        }
        var facts: [String] = []
        if let justLogged, !justLogged.isEmpty { facts.append("just logged: \(justLogged)") }
        if let value = summary.caloriesConsumed { facts.append("eaten today: \(Int(value)) kcal") }
        if let value = remaining { facts.append("calories left to target: \(Int(value))") }
        if let value = summary.protein { facts.append("protein so far: \(Int(value)) g") }
        if let value = proteinLeft { facts.append("protein left: \(Int(value)) g") }
        if let value = summary.totalExpenditure { facts.append("burned today: \(Int(value)) kcal") }

        let instructions = """
        You are a practical nutrition coach inside someone's private dashboard. Suggest \
        what to eat for the rest of the day so they land near their targets: name \
        specific meals with rough portions. Three sentences at most. Use only the \
        numbers given; never invent data. Never give medical advice.
        \(context.isEmpty ? "" : "Background on this person: \(context)")
        """
        let response = try await session(instructions).respond(to: facts.joined(separator: ", "))
        return response.content
    }

    /// Free-form chat, streamed so the UI fills in as it generates. The model is given
    /// the whole dashboard — today, goals, recent trend, what was eaten — so questions
    /// about meals, nutrition and health metrics can all be answered from one place,
    /// plus the transcript so far so follow-ups keep their referents.
    func ask(_ question: String, summary: DaySummary, dashboard: Dashboard?,
             history: [ChatMessage], context: String) -> LanguageModelSession.ResponseStream<String> {
        let instructions = """
        You are Fuel's coach, answering questions about this person's own health and \
        nutrition data inside their private dashboard. Answer briefly and concretely, \
        using only the data below. If something is not in the data, say so rather than \
        guessing. Never give medical advice.

        \(Self.dashboardBriefing(summary: summary, dashboard: dashboard))
        \(context.isEmpty ? "" : "Background on this person: \(context)")
        \(Self.transcript(history))
        """
        return session(instructions).streamResponse(to: question)
    }

    /// Everything the coach is allowed to reason from, flattened to text.
    private static func dashboardBriefing(summary: DaySummary, dashboard: Dashboard?) -> String {
        var lines: [String] = ["TODAY (\(summary.date)):"]
        func add(_ label: String, _ value: Double?, _ unit: String, decimals: Int = 0) {
            guard let value else { return }
            lines.append("- \(label): \(String(format: "%.\(decimals)f", value))\(unit)")
        }
        add("calories consumed", summary.caloriesConsumed, " kcal")
        add("calories burned", summary.totalExpenditure, " kcal")
        add("protein", summary.protein, " g")
        add("carbs", summary.carbs, " g")
        add("fat", summary.fat, " g")
        add("fiber", summary.fiber, " g")
        add("steps", summary.stepCount, "")
        add("exercise", summary.exerciseMinutes, " min")
        add("sleep", summary.sleepHours, " h", decimals: 1)
        add("resting heart rate", summary.restingHeartRate, " bpm")
        add("HRV", summary.hrv, " ms")
        add("VO2 max", summary.vo2Max, "", decimals: 1)

        if let foods = dashboard?.today.foodEntries, !foods.isEmpty {
            lines.append("MEALS TODAY:")
            for food in foods {
                let kcal = food.calories.map { " — \(Int($0)) kcal" } ?? ""
                lines.append("- \(food.time ?? "") \(food.food ?? "")\(kcal)")
            }
        }
        if let goals = dashboard?.goals {
            lines.append("GOALS:")
            if let value = goals.calories?.target { lines.append("- calories: \(Int(value))") }
            if let value = goals.protein?.target { lines.append("- protein: \(Int(value)) g") }
            if let value = goals.fiber?.target { lines.append("- fiber: \(Int(value)) g") }
            if let value = goals.steps?.target { lines.append("- steps: \(Int(value))") }
            if let value = goals.sleepHours?.target { lines.append("- sleep: \(Int(value)) h") }
        }
        // A short trend window, so "how does that compare to usual?" is answerable.
        if let trends = dashboard?.trends.suffix(7), !trends.isEmpty {
            let recent = trends.compactMap { day -> String? in
                guard let kcal = day.caloriesConsumed else { return nil }
                return "\(day.date): \(Int(kcal)) kcal"
            }
            if !recent.isEmpty { lines.append("LAST 7 DAYS EATEN: " + recent.joined(separator: ", ")) }
        }
        return lines.joined(separator: "\n")
    }

    /// The last few turns, so pronouns and follow-ups resolve.
    private static func transcript(_ history: [ChatMessage]) -> String {
        let recent = history.suffix(8).filter { !$0.text.isEmpty }
        guard !recent.isEmpty else { return "" }
        return "CONVERSATION SO FAR:\n" + recent
            .map { "\($0.role == .user ? "Them" : "You"): \($0.text)" }
            .joined(separator: "\n")
    }
}
