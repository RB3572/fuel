import SwiftUI
import BackgroundTasks
import AuthenticationServices

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
                    await store.loadEditableState()
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

/// First run. The same credentials as the website: the Google account you already use,
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

                Text("Use the same account as fuel.rishib.com and you'll see the same data.")
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
