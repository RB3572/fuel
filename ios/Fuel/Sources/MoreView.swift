import SwiftUI
import UIKit

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
                    NavigationLink { SyncSettingsView() } label: {
                        Label("Sync settings", systemImage: "arrow.triangle.2.circlepath")
                    }
                } footer: {
                    Text("Fuel sends one row per day — your totals, like steps walked and calories burned — not the thousands of individual readings behind them. Everything stays on this iPhone in Health.")
                }

                Section {
                    NavigationLink { NotificationSettingsView() } label: {
                        Label("Notifications", systemImage: "bell")
                    }
                } footer: {
                    Text("Fuel never sends reminders to log — nothing here nags. Every notification is the Coach, either answering something you asked or telling you something it noticed.")
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
                    NavigationLink { JourneysView() } label: { Label("Journeys", systemImage: "globe.americas.fill") }
                    NavigationLink { BloodView() } label: { Label("Blood results", systemImage: "drop.fill") }
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

/// When Fuel syncs, and whether what you log here goes back to Apple Health.
struct SyncSettingsView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme
    @ObservedObject private var syncStore = SyncStore.shared
    @State private var writeBack = HealthWriter.shared.enabled

    private static let intervals = [15, 30, 60, 120, 240]

    private var dailyTime: Binding<Date> {
        Binding(
            get: {
                var components = DateComponents()
                components.hour = syncStore.dailySyncMinute / 60
                components.minute = syncStore.dailySyncMinute % 60
                return Calendar.current.date(from: components) ?? Date()
            },
            set: { date in
                let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
                syncStore.dailySyncMinute = (parts.hour ?? 7) * 60 + (parts.minute ?? 0)
            })
    }

    var body: some View {
        List {
            Section {
                Toggle("Sync in the background", isOn: $syncStore.backgroundSyncEnabled)
            } footer: {
                Text("Off means Fuel only syncs while it is open — on launch, coming back to it, or pulling to refresh. Everything below applies to the automatic ones; anything you ask for by hand always runs.")
            }

            if syncStore.backgroundSyncEnabled {
                Section {
                    Picker("At most every", selection: $syncStore.minimumSyncInterval) {
                        ForEach(Self.intervals, id: \.self) { minutes in
                            Text(minutes < 60 ? "\(minutes) minutes" : "\(minutes / 60) hour\(minutes == 60 ? "" : "s")").tag(minutes)
                        }
                    }
                } header: {
                    Text("How often")
                } footer: {
                    Text("A sync asked for sooner than this is skipped rather than queued: every sync re-reads the last three days, so the next one covers the same ground.")
                }

                Section {
                    Toggle("When Health records something", isOn: $syncStore.syncOnHealthUpdate)
                    Toggle("As soon as a workout ends", isOn: $syncStore.syncAfterWorkout)
                    Toggle("Once a day", isOn: $syncStore.dailySyncEnabled.animation())
                    if syncStore.dailySyncEnabled {
                        DatePicker("At", selection: dailyTime, displayedComponents: .hourAndMinute)
                    }
                } header: {
                    Text("What starts one")
                } footer: {
                    Text("A finished workout ignores the interval above — it is the one moment where waiting means looking at a dashboard you can see is wrong. iOS decides the exact timing of background work, so a daily sync happens near that time rather than on the dot.")
                }
            }

            Section {
                Toggle("Write my food to Apple Health", isOn: $writeBack)
                    .onChange(of: writeBack) { _, on in HealthWriter.shared.enabled = on }
            } header: {
                Text("Back to Health")
            } footer: {
                Text("Sends what you log in Fuel — calories, protein, carbs, fat, fibre and the micronutrients Health has a place for — to the Health app, so other apps can read it. Only food you logged here is ever written, never anything Fuel read from Health, and a blank field is left blank rather than written as zero. Turning it on asks for permission separately; turning it off stops immediately and leaves what was already written where it is, for you to keep or delete in Health.")
            }

            Section {
                LabeledContent("Last sync", value: syncStore.lastSyncSummary.isEmpty ? "—" : syncStore.lastSyncSummary)
                    .font(.footnote)
            }
        }
        .navigationTitle("Sync settings")
        .navigationBarTitleDisplayMode(.inline)
    }
}

/// One master switch for the coach speaking up first, and separate toggles underneath
/// for exactly which kinds of outreach that covers — plus a reply toggle that stands on
/// its own, since answering a question isn't outreach.
struct NotificationSettingsView: View {
    @Bindable private var notifications = Notifications.shared
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        List {
            Section {
                Toggle("Coach replies", isOn: $notifications.repliesEnabled)
            } footer: {
                Text("When an answer you asked for finishes after you've left the app. Always available — this isn't outreach, it's the coach getting back to you.")
            }

            Section {
                Toggle("Let coach message me", isOn: $notifications.proactiveEnabled)
                if notifications.proactiveEnabled {
                    Toggle("Workout reactions", isOn: $notifications.workoutReactionsEnabled)
                    Toggle("Weekly rundown", isOn: $notifications.weeklyRundownEnabled)
                }
            } header: {
                Text("The coach reaching out first")
            } footer: {
                Text("With this on, the coach can message you without being asked: a congratulations and a suggestion right after a workout syncs, and a rundown of your week — workouts, sleep, meals, what's working — Saturday mornings. Off means the coach never speaks first, only replies.")
            }

            if (notifications.repliesEnabled || notifications.proactiveEnabled) && notifications.deniedBySystem {
                Section {
                    Button {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    } label: {
                        Label("Allow notifications in Settings", systemImage: "exclamationmark.triangle")
                    }
                } footer: {
                    Text("iOS is blocking notifications for Fuel. These toggles won't do anything until you allow them in Settings.")
                }
            }
        }
        .navigationTitle("Notifications")
        .navigationBarTitleDisplayMode(.inline)
        .task { await notifications.refreshAuthorizationState() }
    }
}
