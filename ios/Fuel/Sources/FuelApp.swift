import SwiftUI
import BackgroundTasks

@main
struct FuelApp: App {
    @State private var store = AppStore.shared
    @State private var ai = OnDeviceAI.shared
    @Environment(\.scenePhase) private var scenePhase

    init() {
        // Must be registered before the app finishes launching.
        BackgroundSync.registerTasks()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(ai)
                .tint(Palette.flameMid)
                .task {
                    await store.load()
                    await store.loadContext()
                    if store.healthAuthorized { BackgroundSync.enableHealthKitDelivery() }
                    await store.syncHealth(reason: "app open")
                }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                Task { await store.load(); await store.syncHealth(reason: "app foreground") }
            case .background:
                BackgroundSync.scheduleAll()
            default: break
            }
        }
    }
}

/// The web app is a single scrolling dashboard with a top nav. On a phone that becomes
/// a tab bar: the four things you actually open the app to do, plus everything else
/// behind More. Log gets the middle slot because it is the only destructive-free action
/// you take several times a day.
struct RootView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        if !store.isSignedIn {
            SetupView()
        } else {
            TabView {
                Tab("Today", systemImage: "flame.fill") { TodayView() }
                Tab("Trends", systemImage: "chart.xyaxis.line") { TrendsView() }
                Tab("Log", systemImage: "camera.fill") { CameraLogView() }
                Tab("Coach", systemImage: "sparkles") { CoachView() }
                Tab("More", systemImage: "ellipsis") { MoreView() }
            }
        }
    }
}

/// First run: sign in with the same OAuth server the website uses. The password and
/// the consent screen both live in the system browser; the app only ever sees a token.
struct SetupView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ZStack {
            Palette.background(scheme).ignoresSafeArea()
            VStack(spacing: 22) {
                BoltMark().frame(width: 76, height: 76)
                VStack(spacing: 6) {
                    Text("Fuel").font(.system(size: 34, weight: .bold, design: .rounded))
                        .foregroundStyle(Palette.ink(scheme))
                    Text("Your dashboard, on your phone.")
                        .font(.system(size: 15)).foregroundStyle(Palette.muted(scheme))
                }
                Button {
                    Task {
                        await store.oauth.signIn()
                        await store.load()
                        await store.loadContext()
                    }
                } label: {
                    HStack {
                        if store.oauth.signingIn { ProgressView().controlSize(.small).tint(.white) }
                        Text(store.oauth.signingIn ? "Signing in…" : "Sign in to Fuel")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(store.oauth.signingIn)

                Text("Opens fuel.rishib.com to sign in. Fuel never sees your password.")
                    .font(.caption).foregroundStyle(Palette.muted(scheme))
                    .multilineTextAlignment(.center)

                if let error = store.oauth.error {
                    Text(error).font(.caption).foregroundStyle(.orange).multilineTextAlignment(.center)
                }
            }
            .padding(24)
        }
    }
}

/// The app icon's bolt, reused in-app so the brand mark appears once, not twice.
struct BoltMark: View {
    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width, h = geo.size.height
            Path { path in
                let pts: [(CGFloat, CGFloat)] = [
                    (0.66, 0.02), (0.17, 0.575), (0.44, 0.575),
                    (0.34, 0.98), (0.83, 0.425), (0.56, 0.425),
                ]
                path.move(to: CGPoint(x: pts[0].0 * w, y: pts[0].1 * h))
                for pt in pts.dropFirst() { path.addLine(to: CGPoint(x: pt.0 * w, y: pt.1 * h)) }
                path.closeSubpath()
            }
            .fill(Palette.flame)
        }
    }
}
