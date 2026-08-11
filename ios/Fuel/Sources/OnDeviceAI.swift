import Foundation
import FoundationModels
import Vision
import UIKit

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

    Calibration anchors — use these to sanity-check the *magnitude* of your estimate, \
    never repeat one back verbatim: a slice of cheese pizza is ~285 kcal; a cup of \
    cooked white rice is ~205 kcal; a 6oz grilled chicken breast is ~280 kcal and ~53g \
    protein; a medium banana is ~105 kcal; a fast-food cheeseburger is ~300-500 kcal; a \
    cup of whole milk is ~150 kcal; a tablespoon of oil or butter is ~100-120 kcal; a \
    restaurant entrée with sides commonly totals 700-1200 kcal, not 300-400 — sides and \
    cooking fat add up fast. When unsure between two plausible portions, prefer the \
    larger, realistic one: people under-photograph how much is actually on the plate \
    far more often than they over-photograph it.
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

    /// Estimates one serving of a shared recipe from its ingredients. On-device
    /// replacement for /api/mlog?fuel_route=recipe-nutrition's Gemini call — every AI
    /// task in this app runs on the phone, including this one, even though the recipe
    /// bank itself is a shared server-side resource. Only the resulting numbers (never
    /// the estimate itself) are sent to the server, via FuelClient.saveRecipeNutrition.
    func estimateRecipeNutrition(name: String, ingredients: [String], serving: String?) async throws -> EstimatedNutrition {
        let servingText = (serving?.isEmpty == false) ? " One serving is: \(serving!)." : " Assume the recipe makes a single serving."
        let ingredientText = ingredients.isEmpty ? "(no ingredients listed)" : ingredients.map { "- \($0)" }.joined(separator: "\n")
        let response = try await session(Self.nutritionist).respond(
            to: """
            Recipe: \(name).\(servingText)
            Estimate the nutrition of ONE SERVING of the finished dish from these ingredients:
            \(ingredientText)
            """,
            generating: EstimatedNutrition.self
        )
        return response.content
    }

    /// Identifies a meal from a photo and estimates its nutrition — the on-device
    /// replacement for the /quicklog pipeline. The image never leaves the device.
    ///
    /// Three on-device stages, because the system language model takes text only:
    /// Vision classifies the scene AND reads any printed text, then the model reasons
    /// over both. Classification alone is a general "what kind of scene is this"
    /// classifier (Apple's Photos-app taxonomy) — it has no notion of a specific
    /// packaged product, so a milk carton or nutrition label reads as visual noise to
    /// it and it was guessing plausible-sounding dishes ("chicken sandwich") from weak
    /// labels. A carton or label carries its own answer printed on it — OCR reads the
    /// brand and product name directly, which is far more reliable than a scene guess
    /// for anything packaged rather than plated.
    func identifyMeal(photo: Data, note: String?) async throws -> IdentifiedMeal {
        let labels = try Self.classify(photo)
        let text = try Self.recognizeText(photo)
        var prompt = "A food photo was analyzed on this device.\n"
        if labels.isEmpty {
            prompt += "Scene classifier found nothing confident."
        } else {
            // Confidence is shown, not just rank, so a 4% guess isn't weighed like a
            // 60% one — the small on-device classifier's top-10-by-rank list used to
            // read as equally plausible options, which is how weak labels like "floor"
            // could end up steering the answer as easily as the correct one.
            prompt += "Scene classifier guesses, with confidence (weigh these proportionally — "
                + "anything under ~10% is likely noise, not a real second candidate): "
                + labels.map { "\($0.name) (\(Int(($0.confidence * 100).rounded()))%)" }.joined(separator: ", ") + "."
        }
        if !text.isEmpty {
            prompt += "\nText read directly off the packaging or label (this is the most reliable signal if present — "
                + "prefer identifying the exact branded product it names over the scene labels above): "
                + text.joined(separator: " | ")
        }
        if let note, !note.isEmpty { prompt += "\nThe person described it as: \(note)." }
        prompt += "\nDecide the single most likely food or drink, give a realistic portion, and estimate its nutrition."
        let response = try await session(Self.nutritionist).respond(to: prompt, generating: IdentifiedMeal.self)
        return response.content
    }

    private struct VisionLabel { let name: String; let confidence: Float }

    /// Vision's built-in classifier, filtered to food-ish confidence, run on the full
    /// frame and — when Vision finds one — a saliency-cropped region, so a dish that
    /// only fills part of the photo (a bowl on a busy table, a cup in a hand) also gets
    /// classified at closer range, the way physically pointing the camera closer would.
    /// The crop is a second opinion only: it can add candidate labels but never removes
    /// what the full frame found, and any failure in it is silently skipped so a bad
    /// crop degrades to "just the full-frame pass," never to an error or a worse guess.
    private static func classify(_ photo: Data) throws -> [VisionLabel] {
        var best: [String: Float] = [:]
        func merge(_ data: Data) throws {
            let request = VNClassifyImageRequest()
            try VNImageRequestHandler(data: data, options: [:]).perform([request])
            for result in request.results ?? [] where result.confidence > 0.05 {
                let name = result.identifier.replacingOccurrences(of: "_", with: " ")
                best[name] = max(best[name] ?? 0, result.confidence)
            }
        }
        try merge(photo)
        if let cropped = salientCrop(photo) { try? merge(cropped) }
        return best.map { VisionLabel(name: $0.key, confidence: $0.value) }
            .sorted { $0.confidence > $1.confidence }
            .prefix(6)
            .map { $0 }
    }

    /// Crops to Vision's most visually salient region, padded so a tight box doesn't
    /// slice into the food itself. Returns nil on anything unexpected rather than
    /// throwing — callers treat this as an optional bonus pass, not a dependency.
    private static func salientCrop(_ photo: Data) -> Data? {
        guard let original = UIImage(data: photo) else { return nil }
        // Bake in EXIF orientation first: CGImage's raw buffer ignores it, but the
        // normalized boundingBox Vision reports below assumes the upright image, so
        // cropping the raw buffer directly against that box would crop the wrong
        // region on any photo not already shot in the sensor's native orientation.
        let upright = original.normalizedToUpOrientation()
        guard let cgImage = upright.cgImage,
              let box = try? classifySaliency(cgImage) else { return nil }
        let w = CGFloat(cgImage.width), h = CGFloat(cgImage.height)
        let padded = box.insetBy(dx: -0.08, dy: -0.08).intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        // Vision's origin is bottom-left with y increasing upward; CGImage cropping
        // expects top-left with y increasing downward, hence the flip.
        let rect = CGRect(x: padded.minX * w, y: (1 - padded.maxY) * h,
                           width: padded.width * w, height: padded.height * h)
        guard rect.width > 40, rect.height > 40, let cropped = cgImage.cropping(to: rect) else { return nil }
        return UIImage(cgImage: cropped).jpegData(compressionQuality: 0.85)
    }

    private static func classifySaliency(_ cgImage: CGImage) throws -> CGRect? {
        let request = VNGenerateAttentionBasedSaliencyImageRequest()
        try VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
        return request.results?.first?.salientObjects?.first?.boundingBox
    }

    /// Reads any text printed in the photo — the brand and product name on a carton,
    /// wrapper, or nutrition label. Empty for a plain plated meal, which is fine: the
    /// prompt falls back to the scene labels above when there's nothing to read.
    private static func recognizeText(_ photo: Data) throws -> [String] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        try VNImageRequestHandler(data: photo, options: [:]).perform([request])
        let lines = (request.results ?? [])
            .compactMap { $0.topCandidates(1).first }
            .filter { $0.confidence > 0.3 }
            .map(\.string)
            .filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        // Cap both count and total length: a dense nutrition-facts panel can produce
        // dozens of short lines, and the point is naming the product, not transcribing
        // the whole label.
        var out: [String] = []
        var length = 0
        for line in lines.prefix(30) {
            length += line.count
            if length > 600 { break }
            out.append(line)
        }
        return out
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

private extension UIImage {
    /// Re-renders with orientation `.up` baked into the pixel buffer. `CGImage` has no
    /// orientation of its own — a photo shot in portrait is commonly stored as a
    /// landscape buffer plus an EXIF tag, which `.cgImage` ignores. Anything that crops
    /// or measures the raw `CGImage` needs this first, or it works in the wrong frame.
    func normalizedToUpOrientation() -> UIImage {
        guard imageOrientation != .up else { return self }
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { _ in draw(in: CGRect(origin: .zero, size: size)) }
    }
}
