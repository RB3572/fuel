import SwiftUI

// Everything that is not a daily action: the Health connection, the account, and the
// escape hatches. On a phone these get a
// tab, because "why has my data stopped arriving" is a question you answer here.

struct MoreView: View {
    @Environment(AppStore.self) private var store
    @Environment(OnDeviceAI.self) private var ai
    @Environment(\.colorScheme) private var scheme
    @State private var syncing = false
    @State private var showContext = false
    @AppStorage("fuelDarkMode") private var darkMode = false
    @ObservedObject private var syncStore = SyncStore.shared
    @Bindable private var keyStore = APIKeyStore.shared
    @State private var usingCustomKey = APIKeyStore.shared.activeProvider != nil

    private var apiKeyBinding: Binding<String> {
        Binding(get: { keyStore.key(for: keyStore.selectedProvider) },
                set: { keyStore.setKey($0, for: keyStore.selectedProvider) })
    }

    private var modelBinding: Binding<String> {
        Binding(get: { keyStore.model(for: keyStore.selectedProvider) },
                set: { keyStore.setModel($0, for: keyStore.selectedProvider) })
    }

    var body: some View {
        @Bindable var store = store
        NavigationStack {
            List {
                Section {
                    if store.healthAuthorized {
                        Label("Connected", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                        LabeledContent("Status", value: store.healthStatus)
                            .font(.footnote)
                        Button {
                            syncing = true
                            Task { await store.syncHealth(reason: "manual"); syncing = false }
                        } label: {
                            HStack {
                                if syncing { ProgressView().controlSize(.small) }
                                Text(syncing ? "Syncing…" : "Sync now")
                            }
                        }
                        .disabled(syncing)
                        Button(role: .destructive) {
                            SyncStore.shared.resetForFullSync()
                            syncing = true
                            Task { await store.syncHealth(reason: "full re-sync"); syncing = false }
                        } label: {
                            Text("Full re-sync (uploads all history)")
                        }
                        .disabled(syncing)
                    } else {
                        Button {
                            Task { await store.requestHealthAccess() }
                        } label: {
                            Label("Connect Apple Health", systemImage: "heart.fill")
                        }
                    }
                } header: {
                    Text("Apple Health")
                } footer: {
                    Text("Fuel reads Health directly. It syncs when you open Fuel, when Health records something new, and periodically in the background.")
                }

                // The per-category toggles are gone with the raw-sample upload they
                // controlled. Leaving switches that no longer change what is sent would
                // be worse than not having them.
                Section {
                    Toggle("Sync in the background", isOn: $syncStore.backgroundSyncEnabled)
                } header: {
                    Text("Sync settings")
                } footer: {
                    Text("Fuel sends one row per day — your totals, like steps walked and calories burned — not the thousands of individual readings behind them. Everything stays on this iPhone in Health. \"Sync in the background\" off means Fuel only syncs while it's open, on launch, on foreground, or pull-to-refresh.")
                }

                Section {
                    switch ai.availability {
                    case .ready:
                        Label("On-device model ready", systemImage: "cpu")
                            .foregroundStyle(.green)
                    case .unavailable(let why):
                        VStack(alignment: .leading, spacing: 4) {
                            Label("Unavailable", systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.orange)
                            Text(why).font(.caption).foregroundStyle(Palette.muted(scheme))
                        }
                        Button("Check again") { ai.refreshAvailability() }
                    }
                } header: {
                    Text("Fuel AI")
                } footer: {
                    Text(keyStore.activeProvider == nil
                         ? "Nutrition estimates, photo identification and coaching all run on this iPhone. Nothing is sent to a model provider."
                         : "Currently using your own \(keyStore.selectedProvider.label) key instead — see AI provider below.")
                }

                Section {
                    Toggle("Use my own API key", isOn: $usingCustomKey)
                    if usingCustomKey {
                        Picker("Provider", selection: $keyStore.selectedProvider) {
                            ForEach(AIProvider.allCases) { Text($0.label).tag($0) }
                        }
                        Picker("Model", selection: modelBinding) {
                            ForEach(keyStore.selectedProvider.availableModels) { option in
                                Text(option.label).tag(option.modelID)
                            }
                        }
                        SecureField("\(keyStore.selectedProvider.label) API key", text: apiKeyBinding)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                    }
                } header: {
                    Text("AI provider")
                } footer: {
                    Text(usingCustomKey
                         ? "Nutrition estimates, photo identification and coaching are sent to \(keyStore.selectedProvider.label) using this key. The key lives only in this device's Keychain — Fuel's own servers never see it."
                         : "Off (default) runs every AI task on this iPhone. Turn on to use your own Claude, ChatGPT, or Gemini key instead.")
                }

                Section {
                    LabeledContent {
                        Text(store.auth.email ?? "Signed in").font(.footnote)
                    } label: {
                        Label("Account", systemImage: "person.crop.circle.fill")
                    }
                    TextField("Server", text: $store.baseURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .font(.system(.footnote, design: .monospaced))
                    Button(role: .destructive) {
                        store.signOut()
                    } label: { Text("Sign out") }
                } header: {
                    Text("Account")
                } footer: {
                    Text("Sign in with Google or Apple. Point Fuel at your own server if you self-host.")
                }

                Section {
                    Toggle(isOn: $darkMode) {
                        Label("Dark Mode", systemImage: darkMode ? "moon.fill" : "sun.max.fill")
                    }
                } header: {
                    Text("Appearance")
                }

                Section {
                    NavigationLink { LiftingView() } label: { Label("Lifting", systemImage: "dumbbell.fill") }
                    NavigationLink { ExploreView() } label: { Label("Explore", systemImage: "chart.xyaxis.line") }
                    NavigationLink { PlacesView() } label: { Label("Places", systemImage: "mappin.and.ellipse") }
                    NavigationLink { RecipesView() } label: { Label("Recipes", systemImage: "book.closed.fill") }
                } header: {
                    Text("Browse")
                } footer: {
                    Text("The rest of Fuel, all reading and writing the same account.")
                }

                Section {
                    Button { showContext = true } label: {
                        Label("Preferences & context", systemImage: "person.text.rectangle")
                    }
                } footer: {
                    Text("Food preferences, allergies, activity and durable guidance the Coach and MCP clients read.")
                }

                Section {
                    Button {
                        Task { await store.load() }
                    } label: { Label("Refresh dashboard", systemImage: "arrow.clockwise") }
                    if let coverage = store.dashboard?.coverage {
                        LabeledContent("History", value: "\(coverage.days ?? 0) days · \(coverage.foodEntries ?? 0) entries")
                            .font(.footnote)
                    }
                }
            }
            .navigationTitle("More")
            .sheet(isPresented: $showContext) { ContextEditorSheet() }
            .onChange(of: usingCustomKey) { _, on in
                // Off means definitely on-device, not "on-device because the field
                // happens to be empty" — so turning the toggle off clears the key
                // rather than leaving it stored but merely unused.
                if !on { keyStore.setKey("", for: keyStore.selectedProvider) }
            }
        }
    }
}
