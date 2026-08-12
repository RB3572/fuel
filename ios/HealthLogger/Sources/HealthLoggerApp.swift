import SwiftUI

@main
struct HealthLoggerApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var store = SyncStore.shared

    init() {
        // BGTask registration has to happen before the app finishes launching.
        BackgroundSync.registerTasks()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(store)
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                // Opening the app is itself a sync trigger.
                guard store.isConfigured else { return }
                Task { await SyncEngine.shared.sync(reason: "opened") }
            case .background:
                Task { await BackgroundSync.scheduleAll() }
            default:
                break
            }
        }
    }
}
