import SwiftUI
import BackgroundTasks
import AuthenticationServices

@main
struct FuelApp: App {
    @State private var store = AppStore.shared
    @State private var ai = OnDeviceAI.shared
    // Held as state rather than read straight off the singleton so changing the palette
    // re-tints the live app: observation tracking is dependable in a View body, less so
    // in a Scene's.
    @State private var theme = DashboardTheme.shared
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("fuelDarkMode") private var darkMode = false

    init() {
        // Must be registered before the app finishes launching.
        BackgroundSync.registerTasks()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(ai)
                .tint(theme.accent)
                .preferredColorScheme(darkMode ? .dark : .light)
                .task {
                    await store.load()
                    await store.loadEditableState()
                    await store.loadContext()
                    if store.healthAuthorized { await BackgroundSync.enableHealthKitDelivery() }
                    await store.syncHealth(reason: "app open")
                    await LocationSampler.shared.captureIfDue()
                }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                Task {
                    await store.load()
                    await store.syncHealth(reason: "app foreground")
                    await LocationSampler.shared.captureIfDue()
                }
            case .background:
                Task { await BackgroundSync.scheduleAll() }
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
    /// Bound so a screen can send you somewhere else — the Coach's back button returns
    /// to Today, since with the keyboard up the tab bar is covered and there is
    /// otherwise no way out.
    @State private var tab: AppTab = .today
    @State private var notifications = Notifications.shared

    var body: some View {
        if !store.isSignedIn {
            SetupView()
        } else {
            TabView(selection: $tab) {
                Tab("Today", systemImage: "flame.fill", value: AppTab.today) { TodayView() }
                Tab("Trends", systemImage: "chart.xyaxis.line", value: AppTab.trends) { TrendsView() }
                Tab("Log", systemImage: "camera.fill", value: AppTab.log) { CameraLogView() }
                Tab("Coach", systemImage: "sparkles", value: AppTab.coach) { CoachView(onBack: { tab = .today }) }
                Tab("More", systemImage: "ellipsis", value: AppTab.more) { MoreView() }
            }
            // Above the status bar and across every tab, because a sync is app-wide and
            // can start from anywhere — launch, foreground, pull-to-refresh, background.
            .overlay(alignment: .top) {
                if store.isSyncing {
                    SyncProgressBar()
                        .transition(.opacity)
                        .ignoresSafeArea(edges: .top)
                }
            }
            .animation(.easeInOut(duration: 0.25), value: store.isSyncing)
            // Logging a meal ends on the dashboard, at the row it just created.
            .onChange(of: store.jumpToToday) { _, jump in
                guard jump else { return }
                withAnimation(.snappy) { tab = .today }
                store.jumpToToday = false
            }
            // Tapping a Coach notification opens the chat it belongs to.
            .onChange(of: notifications.openCoachRequested) { _, requested in
                guard requested else { return }
                tab = .coach
                notifications.openCoachRequested = false
            }
            .task { await notifications.refreshAuthorizationState() }
            // Tapping a Home Screen widget opens the tab it came from, via fuel://<tab>.
            // A Lock Screen or Control Center control arrives differently: it can only
            // open a universal link (https://fuel.rishib.com/open?dest=<tab>), never the
            // custom scheme, so both shapes are read here into the same destination.
            .onOpenURL { url in
                let destination: String?
                if url.scheme == "fuel" {
                    destination = url.host
                } else if url.host == "fuel.rishib.com", url.path == "/open" {
                    destination = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                        .queryItems?.first { $0.name == "dest" }?.value
                } else {
                    destination = nil
                }
                switch destination {
                case "today": tab = .today
                case "trends": tab = .trends
                case "log": tab = .log
                case "coach": tab = .coach
                case "more": tab = .more
                default: break
                }
            }
        }
    }
}

/// A hairline determinate bar. Deliberately not a spinner or a banner: a sync is
/// frequent, usually quick, and never something to interrupt what you were reading.
///
/// The fill is the real fraction of the sync's work — each of HealthKit's per-metric
/// statistics queries reports as it lands — rather than an animation that merely looks
/// busy, so a stalled sync is visibly stalled.
struct SyncProgressBar: View {
    @ObservedObject private var syncStore = SyncStore.shared

    var body: some View {
        GeometryReader { geo in
            Capsule()
                .fill(DashboardTheme.shared.accent)
                .frame(width: max(2, geo.size.width * syncStore.syncProgress), height: 3)
                .animation(.easeOut(duration: 0.25), value: syncStore.syncProgress)
        }
        .frame(height: 3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(DashboardTheme.shared.accent.opacity(0.15))
        .accessibilityLabel("Syncing health data")
        .accessibilityValue("\(Int(syncStore.syncProgress * 100)) percent")
    }
}

enum AppTab: Hashable { case today, trends, log, coach, more }

/// First run. Sign in with the Google account you already use,
/// or Apple. Both are native sheets — there is no Fuel consent screen in the way.
struct SetupView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        ZStack {
            Palette.background(scheme).ignoresSafeArea()
            VStack(spacing: 20) {
                Spacer()
                BoltMark().frame(width: 76, height: 76)
                VStack(spacing: 6) {
                    Text("Fuel").font(.system(size: 34, weight: .bold, design: .rounded))
                        .foregroundStyle(Palette.ink(scheme))
                    Text("Your dashboard, on your phone.")
                        .font(.system(size: 15)).foregroundStyle(Palette.muted(scheme))
                }
                Spacer()

                SignInWithAppleButton(.signIn) { _ in } onCompletion: { _ in }
                    .signInWithAppleButtonStyle(scheme == .dark ? .white : .black)
                    .frame(height: 50)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    // The real request runs through our own controller so the identity
                    // token can be forwarded to Fuel; the button is the system chrome.
                    .allowsHitTesting(false)
                    .overlay(
                        Button { Task { await store.auth.signInWithApple(); await afterSignIn() } } label: {
                            Color.clear
                        }
                    )

                // Google's own mark and wording, on a button built to the same
                // measurements as Apple's — 50pt tall, 12pt radius — so the pair reads
                // as one stack rather than two borrowed components.
                Button {
                    Task { await store.auth.signInWithGoogle(); await afterSignIn() }
                } label: {
                    HStack(spacing: 12) {
                        Image("GoogleG").resizable().frame(width: 20, height: 20)
                        Text("Sign in with Google")
                            .font(.system(size: 19, weight: .medium))
                            .foregroundStyle(scheme == .dark ? Color(hex: 0xE3E3E3) : Color(hex: 0x1F1F1F))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(scheme == .dark ? Color(hex: 0x131314) : .white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(scheme == .dark ? Color(hex: 0x8E918F) : Color(hex: 0xDADCE0), lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)

                if store.auth.busy { ProgressView().padding(.top, 4) }

                Text("Sign in to sync your data across your devices.")
                    .font(.caption).foregroundStyle(Palette.muted(scheme))
                    .multilineTextAlignment(.center)

                if let error = store.auth.error {
                    Text(error).font(.caption).foregroundStyle(.orange).multilineTextAlignment(.center)
                }
                Spacer().frame(height: 20)
            }
            .padding(24)
        }
    }

    private func afterSignIn() async {
        guard store.isSignedIn else { return }
        await store.load()
        await store.loadContext()
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
