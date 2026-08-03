import SwiftUI

// Everything that is not a daily action: the Health connection, the account, and the
// escape hatches. The website keeps these behind a profile menu; on a phone they get a
// tab, because "why has my data stopped arriving" is a question you answer here.

struct MoreView: View {
    @Environment(AppStore.self) private var store
    @Environment(OnDeviceAI.self) private var ai
    @Environment(\.colorScheme) private var scheme
    @State private var syncing = false

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
                    Text("Fuel reads Health directly — no Shortcut and no companion app. It syncs when you open Fuel, when Health records something new, and periodically in the background.")
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
                    Text("Nutrition estimates, photo identification and coaching all run on this iPhone. Nothing is sent to a model provider.")
                }

                Section {
                    Label("Signed in", systemImage: "person.crop.circle.fill")
                        .foregroundStyle(.green)
                    TextField("Server", text: $store.baseURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .font(.system(.footnote, design: .monospaced))
                    Button(role: .destructive) {
                        store.oauth.signOut()
                    } label: { Text("Sign out") }
                } header: {
                    Text("Account")
                } footer: {
                    Text("Signed in with the same account as the website, over OAuth. Fuel talks to the same database — point it at your own server if you self-host.")
                }

                Section {
                    Button {
                        Task { await store.load() }
                    } label: { Label("Refresh dashboard", systemImage: "arrow.clockwise") }
                    if let coverage = store.dashboard?.coverage {
                        LabeledContent("History", value: "\(coverage.days ?? 0) days · \(coverage.foodEntries ?? 0) entries")
                            .font(.footnote)
                    }
                    Link(destination: URL(string: store.baseURL)!) {
                        Label("Open Fuel on the web", systemImage: "safari")
                    }
                }
            }
            .navigationTitle("More")
        }
    }
}
