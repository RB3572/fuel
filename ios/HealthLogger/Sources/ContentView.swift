import SwiftUI
import HealthKit
import UIKit

// The whole UI. Deliberately minimal — this app is a bridge, not a dashboard. Fuel on
// the web owns charts, insights and goals; this screen exists to be set up once and
// then glanced at to confirm syncs are flowing.
//
// Fuel is the one-tap default, but the destination is not hard-wired: point it at any
// server implementing the same protocol, or skip servers entirely and export the whole
// history to a file.

struct ContentView: View {
    @EnvironmentObject private var store: SyncStore
    @State private var authorized = UserDefaults.standard.bool(forKey: "hkAuthorized")
    @State private var showToken = false
    @State private var exporting = false
    @State private var export: ExportedFile?

    /// The share sheet needs an Identifiable item; a bare URL is not one.
    struct ExportedFile: Identifiable { let id = UUID(); let url: URL }

    private var destination: Binding<Bool> {
        Binding(get: { store.isFuelDestination },
                set: { $0 ? store.useFuel() : store.useCustom() })
    }

    var body: some View {
        NavigationStack {
            List {
                statusSection
                destinationSection

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
                    .disabled(!canSync)

                    Button(role: .destructive) {
                        store.resetForFullSync()
                        Task { await SyncEngine.shared.sync(reason: "full re-sync") }
                    } label: {
                        Label("Full re-sync (uploads all history)", systemImage: "clock.arrow.circlepath")
                    }
                    .disabled(!canSync)
                } footer: {
                    Text("Syncs also run automatically: when you open the app, when Health records new data, and periodically in the background.")
                }

                Section {
                    Button {
                        exporting = true
                        Task {
                            let url = await SyncEngine.shared.export()
                            exporting = false
                            if let url { export = ExportedFile(url: url) }
                        }
                    } label: {
                        Label(exporting ? "Preparing export…" : "Export all Health data", systemImage: "square.and.arrow.up")
                    }
                    .disabled(!authorized || isRunning)
                } header: {
                    Text("Your data")
                } footer: {
                    Text("Writes your entire Health history to a file you can save or send anywhere — one JSON batch per line, the same format this app posts. Exporting never changes what has or hasn't been synced.")
                }
            }
            .navigationTitle("Health Logger")
            .sheet(item: $export) { ShareSheet(url: $0.url) }
        }
    }

    private var canSync: Bool { store.isConfigured && authorized && !isRunning }

    private var isRunning: Bool {
        if case .running = store.status { return true }
        return false
    }

    @ViewBuilder
    private var destinationSection: some View {
        Section("Destination") {
            Picker("Send to", selection: destination) {
                Text("Fuel").tag(true)
                Text("Custom server").tag(false)
            }
            .pickerStyle(.segmented)

            if !store.isFuelDestination {
                TextField("https://example.com/api/health/sync/v1", text: $store.customEndpoint)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .font(.system(.footnote, design: .monospaced))
                    .onChange(of: store.customEndpoint) { _, new in store.endpoint = new }
            }

            HStack {
                if showToken {
                    TextField(tokenPrompt, text: $store.token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .font(.system(.footnote, design: .monospaced))
                } else {
                    SecureField(tokenPrompt, text: $store.token)
                        .font(.system(.footnote, design: .monospaced))
                }
                Button { showToken.toggle() } label: {
                    Image(systemName: showToken ? "eye.slash" : "eye")
                }
                .buttonStyle(.borderless)
            }

            Text(store.isFuelDestination
                 ? "Fuel → More → Sync setup → Copy token"
                 : "Sent as a Bearer token. Leave empty if your server doesn't need one.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var tokenPrompt: String { store.isFuelDestination ? "Fuel sync token" : "Bearer token (optional)" }

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
                        Text("Choose a destination, allow Health access, then tap Sync now.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}

/// The system share sheet, so an export can go to Files, AirDrop, Mail — anywhere.
struct ShareSheet: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }
    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
