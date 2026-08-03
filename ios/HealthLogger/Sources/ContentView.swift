import SwiftUI
import HealthKit

// The whole UI. Deliberately minimal — this app is a bridge, not a dashboard. Fuel on
// the web owns charts, insights and goals; this screen exists to be set up once and
// then glanced at to confirm syncs are flowing.

struct ContentView: View {
    @EnvironmentObject private var store: SyncStore
    @State private var authorized = UserDefaults.standard.bool(forKey: "hkAuthorized")
    @State private var showToken = false

    var body: some View {
        NavigationStack {
            List {
                statusSection

                Section("Fuel account") {
                    HStack {
                        if showToken {
                            TextField("Fuel sync token", text: $store.token)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .font(.system(.footnote, design: .monospaced))
                        } else {
                            SecureField("Fuel sync token", text: $store.token)
                                .font(.system(.footnote, design: .monospaced))
                        }
                        Button { showToken.toggle() } label: {
                            Image(systemName: showToken ? "eye.slash" : "eye")
                        }
                        .buttonStyle(.borderless)
                    }
                    Text("Fuel → More → Sync setup → Copy token")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section("Apple Health") {
                    if authorized {
                        Label("Access granted", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    } else {
                        Button {
                            Task {
                                do {
                                    try await SyncEngine.shared.requestAuthorization()
                                } catch {
                                    // Never claim access we do not have: a silent failure here
                                    // means every later sync finds nothing and the app looks
                                    // healthy while uploading empty pages forever.
                                    store.status = .failed("Health access failed: \(error.localizedDescription)")
                                    return
                                }
                                authorized = true
                                UserDefaults.standard.set(true, forKey: "hkAuthorized")
                                BackgroundSync.enableHealthKitDelivery()
                            }
                        } label: {
                            Label("Allow Health access", systemImage: "heart.fill")
                        }
                    }
                }

                Section {
                    Button {
                        Task { await SyncEngine.shared.sync(reason: "manual") }
                    } label: {
                        Label("Sync now", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .disabled(!store.isConfigured || !authorized || isRunning)

                    Button(role: .destructive) {
                        store.resetForFullSync()
                        Task { await SyncEngine.shared.sync(reason: "full re-sync") }
                    } label: {
                        Label("Full re-sync (uploads all history)", systemImage: "clock.arrow.circlepath")
                    }
                    .disabled(!store.isConfigured || !authorized || isRunning)
                } footer: {
                    Text("Syncs also run automatically: when you open the app, when Health records new data, and periodically in the background.")
                }
            }
            .navigationTitle("Health Logger")
        }
    }

    private var isRunning: Bool {
        if case .running = store.status { return true }
        return false
    }

    @ViewBuilder
    private var statusSection: some View {
        Section {
            switch store.status {
            case .running(let stage):
                HStack(spacing: 12) {
                    ProgressView()
                    VStack(alignment: .leading, spacing: 2) {
                        Text(store.initialSyncComplete ? "Syncing" : "First sync — uploading your history")
                            .font(.headline)
                        Text(stage).font(.caption).foregroundStyle(.secondary)
                    }
                }
            case .failed(let message):
                VStack(alignment: .leading, spacing: 4) {
                    Label("Sync failed", systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                        .font(.headline)
                    Text(message).font(.caption).foregroundStyle(.secondary)
                }
            case .idle:
                VStack(alignment: .leading, spacing: 4) {
                    if let at = store.lastSyncAt {
                        Label("Up to date", systemImage: "checkmark.seal.fill")
                            .foregroundStyle(.green)
                            .font(.headline)
                        Text("Last sync \(at.formatted(.relative(presentation: .named))) · \(store.lastSyncSummary)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    } else {
                        Label("Not synced yet", systemImage: "icloud.slash")
                            .font(.headline)
                        Text("Paste your token, allow Health access, then tap Sync now.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}
