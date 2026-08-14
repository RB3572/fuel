import Foundation

// Lets someone use their own Claude, ChatGPT, or Gemini key instead of the on-device
// model — a straight override, not a fallback: OnDeviceAI checks `activeProvider` first
// and routes every AI task to RemoteAI when a key is set, on-device otherwise. Keys are
// Keychain-only, one item per provider (Keychain is defined in SyncStore.swift), so
// switching providers never loses a key you already typed in.

enum AIProvider: String, CaseIterable, Identifiable {
    case claude, openAI, gemini
    var id: String { rawValue }
    var label: String {
        switch self {
        case .claude: return "Claude"
        case .openAI: return "ChatGPT"
        case .gemini: return "Gemini"
        }
    }
    fileprivate var keychainKey: String {
        switch self {
        case .claude: return "fuel-api-key-anthropic"
        case .openAI: return "fuel-api-key-openai"
        case .gemini: return "fuel-api-key-gemini"
        }
    }

    struct ModelOption: Identifiable, Hashable {
        var id: String { modelID }
        var modelID: String
        var label: String
    }

    /// Each provider's current models, most-to-least capable. A provider retiring a
    /// model (Gemini did exactly this to 2.5 Flash) only ever means editing this list —
    /// never a silently-broken hardcoded string buried in a request body.
    var availableModels: [ModelOption] {
        switch self {
        case .claude: return [
            ModelOption(modelID: "claude-opus-5", label: "Claude Opus 5 — most capable"),
            ModelOption(modelID: "claude-sonnet-5", label: "Claude Sonnet 5 — balanced"),
            ModelOption(modelID: "claude-haiku-4-5", label: "Claude Haiku 4.5 — fastest"),
        ]
        case .openAI: return [
            ModelOption(modelID: "gpt-5.6-sol", label: "GPT-5.6 Sol — most capable"),
            ModelOption(modelID: "gpt-5.6-terra", label: "GPT-5.6 Terra — balanced"),
            ModelOption(modelID: "gpt-5.6-luna", label: "GPT-5.6 Luna — fastest"),
        ]
        case .gemini: return [
            ModelOption(modelID: "gemini-2.5-pro", label: "Gemini 2.5 Pro — most capable"),
            ModelOption(modelID: "gemini-3.7-flash", label: "Gemini 3.7 Flash — balanced"),
            ModelOption(modelID: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite — fastest"),
        ]
        }
    }

    /// The balanced middle tier — always index 1 of `availableModels` by construction.
    var defaultModel: String { availableModels[1].modelID }
}

@MainActor
@Observable
final class APIKeyStore {
    static let shared = APIKeyStore()

    /// Which provider's key the person is currently editing/using in the picker — not
    /// necessarily the one AI calls are routed to; see `activeProvider`.
    var selectedProvider: AIProvider {
        didSet { UserDefaults.standard.set(selectedProvider.rawValue, forKey: "fuelAIProvider") }
    }
    private(set) var keys: [AIProvider: String] = [:]
    private(set) var selectedModels: [AIProvider: String] = [:]

    /// The provider AI calls actually use: the selected one, but only if it has a key.
    /// A provider picked with no key yet falls back to on-device rather than failing —
    /// "no keys entered" (any provider) is exactly the on-device-default case.
    var activeProvider: AIProvider? {
        let key = keys[selectedProvider] ?? ""
        return key.isEmpty ? nil : selectedProvider
    }

    func key(for provider: AIProvider) -> String { keys[provider] ?? "" }

    func setKey(_ value: String, for provider: AIProvider) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        keys[provider] = trimmed
        Keychain.set(trimmed, for: provider.keychainKey)
    }

    /// The model actually sent on each request — the stored pick if it's still one of
    /// the provider's current options, else the provider's default. Falling back rather
    /// than trusting a stale stored ID is what makes a provider retiring a model a
    /// non-event for someone who already had it selected, instead of the exact bug this
    /// existed to fix happening again on the next request.
    func model(for provider: AIProvider) -> String {
        guard let stored = selectedModels[provider],
              provider.availableModels.contains(where: { $0.modelID == stored })
        else { return provider.defaultModel }
        return stored
    }

    func setModel(_ modelID: String, for provider: AIProvider) {
        selectedModels[provider] = modelID
        UserDefaults.standard.set(modelID, forKey: "fuelAIModel-\(provider.rawValue)")
    }

    private init() {
        let stored = UserDefaults.standard.string(forKey: "fuelAIProvider").flatMap(AIProvider.init(rawValue:))
        selectedProvider = stored ?? .claude
        for provider in AIProvider.allCases {
            keys[provider] = Keychain.get(provider.keychainKey) ?? ""
            if let model = UserDefaults.standard.string(forKey: "fuelAIModel-\(provider.rawValue)") {
                selectedModels[provider] = model
            }
        }
    }
}
