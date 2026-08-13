import Foundation

// The bring-your-own-key path: same method surface as OnDeviceAI, same result types,
// but backed by a real API call to whichever provider the person configured in More.
// OnDeviceAI is the router — every call here comes from a method that already checked
// APIKeyStore.shared.activeProvider is non-nil, so a missing/empty key never reaches
// this file in normal use; the guards below are a second line of defense, not the
// primary check.
//
// No streaming: a single request, one parsed result. Token-by-token rendering is a
// nice-to-have OnDeviceAI already gets for free from FoundationModels; adding three
// from-scratch SSE parsers for it isn't worth the risk on a path this hard to test
// without live keys. The coach still reads as "thinking, then answers" either way.

enum RemoteAIError: LocalizedError {
    case missingKey(AIProvider)
    case badResponse(String)
    case unreadableReply

    var errorDescription: String? {
        switch self {
        case .missingKey(let provider): return "No \(provider.label) API key is set."
        case .badResponse(let message): return message
        case .unreadableReply: return "The model's reply couldn't be read."
        }
    }
}

enum RemoteAI {
    // MARK: - Public surface, mirroring OnDeviceAI

    static func estimateNutrition(food: String, portion: String?, provider: AIProvider, key: String, model: String) async throws -> EstimatedNutrition {
        let portionText = (portion?.isEmpty == false) ? " Portion: \(portion!)." : ""
        let text = try await complete(
            provider: provider, key: key, model: model, instructions: Self.nutritionistInstructions,
            prompt: "Food: \(food).\(portionText)\n\n\(Self.nutritionSchemaPrompt)",
            image: nil, jsonMode: true
        )
        return try decode(EstimatedNutrition.self, from: text)
    }

    static func estimateRecipeNutrition(name: String, ingredients: [String], serving: String?, provider: AIProvider, key: String, model: String) async throws -> EstimatedNutrition {
        let servingText = (serving?.isEmpty == false) ? " One serving is: \(serving!)." : " Assume the recipe makes a single serving."
        let ingredientText = ingredients.isEmpty ? "(no ingredients listed)" : ingredients.map { "- \($0)" }.joined(separator: "\n")
        let text = try await complete(
            provider: provider, key: key, model: model, instructions: Self.nutritionistInstructions,
            prompt: """
            Recipe: \(name).\(servingText)
            Estimate the nutrition of ONE SERVING of the finished dish from these ingredients:
            \(ingredientText)

            \(Self.nutritionSchemaPrompt)
            """,
            image: nil, jsonMode: true
        )
        return try decode(EstimatedNutrition.self, from: text)
    }

    /// Unlike the on-device path, a real multimodal request sends the photo itself —
    /// no Vision classifier, no OCR pre-pass needed, the model just looks at the image.
    static func identifyMeal(photo: Data, note: String?, provider: AIProvider, key: String, model: String) async throws -> IdentifiedMeal {
        var prompt = "Identify the food or drink in this photo and estimate its nutrition."
        if let note, !note.isEmpty { prompt += " The person added: \(note)." }
        prompt += "\n\n" + """
        Respond with ONLY a JSON object of this exact shape, no other text:
        {"name": string, "portion": string or null, "meal": one of "breakfast"|"lunch"|"dinner"|"snack" or null, \
        "nutrition": {"calories": number or null, "protein": number or null, "carbs": number or null, "fat": number or null, "fiber": number or null}}
        """
        let text = try await complete(
            provider: provider, key: key, model: model, instructions: Self.nutritionistInstructions,
            prompt: prompt, image: photo, jsonMode: true
        )
        return try decode(IdentifiedMeal.self, from: text)
    }

    /// The bring-your-own-key half of OnDeviceAI.interpret. The schema is spelled out in
    /// the prompt because these providers have no equivalent of constrained decoding —
    /// what comes back is ordinary JSON text that still has to parse into CoachAction.
    static func learnFromData(digest: String, existingContext: String,
                              provider: AIProvider, key: String, model: String) async throws -> [String] {
        let instructions = """
        You study a person's own logged health data and identify short, durable patterns \
        a coach should remember about them — routines, preferred foods, places, and \
        workout patterns including timing. Ground every observation in the data given; \
        never invent a pattern the data doesn't support. Never repeat anything already \
        covered by their existing stated preferences below.

        EXISTING STATED PREFERENCES:
        \(existingContext.isEmpty ? "(none yet)" : existingContext)
        """
        let text = try await complete(
            provider: provider, key: key, model: model, instructions: instructions,
            prompt: """
            \(digest)

            Respond with ONLY a JSON object of this exact shape, no other text: \
            {"bullets": ["...", "..."]} — 4 to 8 short strings.
            """,
            image: nil, jsonMode: true
        )
        return try decode(LearnedNotes.self, from: text).bullets
    }

    static func interpret(_ message: String, instructions: String,
                          provider: AIProvider, key: String, model: String) async throws -> CoachAction {
        let text = try await complete(
            provider: provider, key: key, model: model, instructions: instructions,
            prompt: """
            \(message)

            Respond with ONLY a JSON object, no other text. Include "kind" and "summary" \
            always; include any of these only when the message specifies them: \
            food, newFood, meal, portion, calories, protein, carbs, fat, fiber, \
            date, totalExpenditure, restingEnergy, activeEnergy, consumed, \
            calorieBalancePercent, proteinGoal, carbsGoal, fatGoal, fiberGoal, stepsGoal, sleepHoursGoal, \
            recipeName, ingredients, servings, setting, enabled, paletteName, contextAddition.
            """,
            image: nil, jsonMode: true
        )
        return try decode(CoachAction.self, from: text)
    }

    static func dailyInsight(summary: DaySummary, goals: Goals?, context: String, provider: AIProvider, key: String, model: String) async throws -> DailyInsight {
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
        on the figures provided; never invent numbers or trends. Two short sentences at \
        most in each field. Never give medical advice.
        \(contextClause(context))
        """
        let text = try await complete(
            provider: provider, key: key, model: model, instructions: instructions,
            prompt: """
            Today so far — \(facts.joined(separator: ", ")). How is the day going, and what should they do next?

            Respond with ONLY a JSON object of this exact shape, no other text: \
            {"summary": string, "suggestion": string}
            """,
            image: nil, jsonMode: true
        )
        return try decode(DailyInsight.self, from: text)
    }

    static func planRestOfDay(justLogged: String?, summary: DaySummary, goals: Goals?, context: String, provider: AIProvider, key: String, model: String) async throws -> String {
        let remaining = (goals?.calories?.target).flatMap { target in summary.caloriesConsumed.map { target - $0 } }
        let proteinLeft = (goals?.protein?.target).flatMap { target in summary.protein.map { target - $0 } }
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
        \(contextClause(context))
        """
        return try await complete(provider: provider, key: key, model: model, instructions: instructions,
                                   prompt: facts.joined(separator: ", "), image: nil, jsonMode: false)
    }

    static func ask(_ question: String, summary: DaySummary, dashboard: Dashboard?, history: [ChatMessage],
                     context: String, provider: AIProvider, key: String, model: String) async throws -> String {
        let instructions = """
        You are Fuel's coach, answering questions about this person's own health and \
        nutrition data inside their private dashboard. Answer briefly and concretely, \
        using only the data below. If something is not in the data, say so rather than \
        guessing. Never give medical advice.

        \(dashboardBriefing(summary: summary, dashboard: dashboard))
        \(contextClause(context))
        """
        let recent = history.suffix(8).filter { !$0.text.isEmpty }
        let transcript = recent.isEmpty ? "" : "\n\nCONVERSATION SO FAR:\n" + recent
            .map { "\($0.role == .user ? "Them" : "You"): \($0.text)" }.joined(separator: "\n")
        return try await complete(provider: provider, key: key, model: model, instructions: instructions,
                                   prompt: question + transcript, image: nil, jsonMode: false)
    }

    // MARK: - Shared prompt text (kept in sync with OnDeviceAI's own wording by hand —
    // small enough that a shared helper would cost more indirection than it saves)

    private static let nutritionistInstructions = """
    You estimate nutrition for foods people log in a fitness app. Give your best numeric \
    estimate for a typical preparation of the described food at the described portion. \
    Use kilocalories and grams. If a field genuinely cannot be estimated, use null rather \
    than guessing wildly. Do not explain your reasoning outside the JSON.
    """
    private static let nutritionSchemaPrompt = """
    Respond with ONLY a JSON object of this exact shape, no other text: \
    {"calories": number or null, "protein": number or null, "carbs": number or null, "fat": number or null, "fiber": number or null}
    """

    private static func contextClause(_ context: String) -> String {
        guard !context.isEmpty else { return "" }
        return """
        This person's own stated preferences and restrictions — treat every one of these \
        as a hard constraint, not background color. Never suggest a food, meal, or \
        exercise that conflicts with them, even when it would otherwise be the obvious \
        answer (e.g. a stated vegetarian must never be offered meat, poultry, or fish):
        \(context)
        """
    }

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
        }
        return lines.joined(separator: "\n")
    }

    // MARK: - Decoding

    private static func decode<T: Decodable>(_ type: T.Type, from text: String) throws -> T {
        guard let data = extractJSONObject(from: text) else { throw RemoteAIError.unreadableReply }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw RemoteAIError.unreadableReply }
    }

    /// Finds the first balanced {...} in the reply, tolerant of a model wrapping its
    /// JSON in a markdown fence or adding a stray sentence before/after — brace-depth
    /// scanning rather than first-{-to-last-} so nested objects don't get truncated.
    private static func extractJSONObject(from text: String) -> Data? {
        guard let start = text.firstIndex(of: "{") else { return nil }
        var depth = 0
        var index = start
        while index < text.endIndex {
            switch text[index] {
            case "{": depth += 1
            case "}":
                depth -= 1
                if depth == 0 { return String(text[start...index]).data(using: .utf8) }
            default: break
            }
            index = text.index(after: index)
        }
        return nil
    }

    // MARK: - Provider dispatch

    private static func complete(provider: AIProvider, key: String, model: String, instructions: String,
                                  prompt: String, image: Data?, jsonMode: Bool) async throws -> String {
        guard !key.isEmpty else { throw RemoteAIError.missingKey(provider) }
        switch provider {
        case .claude: return try await completeClaude(key: key, model: model, instructions: instructions, prompt: prompt, image: image)
        case .openAI: return try await completeOpenAI(key: key, model: model, instructions: instructions, prompt: prompt, image: image, jsonMode: jsonMode)
        case .gemini: return try await completeGemini(key: key, model: model, instructions: instructions, prompt: prompt, image: image, jsonMode: jsonMode)
        }
    }

    private static func post(_ url: URL, headers: [String: String], body: [String: Any]) async throws -> [String: Any] {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        for (field, value) in headers { request.setValue(value, forHTTPHeaderField: field) }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw RemoteAIError.badResponse("No response from the server.") }
        guard (200...299).contains(http.statusCode) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])
                .flatMap { ($0["error"] as? [String: Any])?["message"] as? String ?? $0["error"] as? String }
            throw RemoteAIError.badResponse(message ?? "Request failed (\(http.statusCode)).")
        }
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw RemoteAIError.badResponse("Unreadable response.")
        }
        return object
    }

    // MARK: Anthropic — https://docs.anthropic.com/en/api/messages

    private static func completeClaude(key: String, model: String, instructions: String, prompt: String, image: Data?) async throws -> String {
        var content: [[String: Any]] = []
        if let image {
            content.append(["type": "image", "source": ["type": "base64", "media_type": "image/jpeg", "data": image.base64EncodedString()]])
        }
        content.append(["type": "text", "text": prompt])
        let body: [String: Any] = [
            "model": model,
            "max_tokens": 1024,
            "system": instructions,
            "messages": [["role": "user", "content": content]],
        ]
        let object = try await post(
            URL(string: "https://api.anthropic.com/v1/messages")!,
            headers: ["x-api-key": key, "anthropic-version": "2023-06-01"],
            body: body
        )
        guard let blocks = object["content"] as? [[String: Any]],
              let text = blocks.compactMap({ $0["text"] as? String }).first
        else { throw RemoteAIError.unreadableReply }
        return text
    }

    // MARK: OpenAI — https://platform.openai.com/docs/api-reference/chat

    private static func completeOpenAI(key: String, model: String, instructions: String, prompt: String, image: Data?, jsonMode: Bool) async throws -> String {
        var userContent: [[String: Any]] = [["type": "text", "text": prompt]]
        if let image {
            userContent.append(["type": "image_url", "image_url": ["url": "data:image/jpeg;base64,\(image.base64EncodedString())"]])
        }
        var body: [String: Any] = [
            "model": model,
            "messages": [
                ["role": "system", "content": instructions],
                ["role": "user", "content": userContent],
            ],
        ]
        if jsonMode { body["response_format"] = ["type": "json_object"] }
        let object = try await post(
            URL(string: "https://api.openai.com/v1/chat/completions")!,
            headers: ["Authorization": "Bearer \(key)"],
            body: body
        )
        guard let choices = object["choices"] as? [[String: Any]],
              let message = choices.first?["message"] as? [String: Any],
              let text = message["content"] as? String
        else { throw RemoteAIError.unreadableReply }
        return text
    }

    // MARK: Gemini — https://ai.google.dev/api/generate-content

    private static func completeGemini(key: String, model: String, instructions: String, prompt: String, image: Data?, jsonMode: Bool) async throws -> String {
        var parts: [[String: Any]] = [["text": prompt]]
        if let image { parts.append(["inlineData": ["mimeType": "image/jpeg", "data": image.base64EncodedString()]]) }
        var generationConfig: [String: Any] = [:]
        if jsonMode { generationConfig["responseMimeType"] = "application/json" }
        let body: [String: Any] = [
            "contents": [["role": "user", "parts": parts]],
            "systemInstruction": ["parts": [["text": instructions]]],
            "generationConfig": generationConfig,
        ]
        let object = try await post(
            URL(string: "https://generativelanguage.googleapis.com/v1beta/models/\(model):generateContent?key=\(key)")!,
            headers: [:],
            body: body
        )
        guard let candidates = object["candidates"] as? [[String: Any]],
              let content = candidates.first?["content"] as? [String: Any],
              let parts = content["parts"] as? [[String: Any]],
              let text = parts.compactMap({ $0["text"] as? String }).first
        else { throw RemoteAIError.unreadableReply }
        return text
    }
}
