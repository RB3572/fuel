import SwiftUI
import FoundationModels

// Fuel AI as a conversation, not a form. It has the whole dashboard — today, goals,
// every meal, the last week's trend — so it can be asked about nutrition, a specific
// meal, or a health metric without switching modes. Logging something from the camera
// drops into the same transcript, but a day plan is only ever built when the user taps
// the plan button — never automatically — and only the most recent plan stays in the
// transcript once built.
//
// All of it runs on this phone. No quota, no round trip, and the photos stay put.

struct CoachView: View {
    @Environment(AppStore.self) private var store
    @Environment(OnDeviceAI.self) private var ai
    @Environment(\.colorScheme) private var scheme

    /// Returns to the dashboard. Needed because the keyboard covers the tab bar, so
    /// without it a focused composer is a dead end.
    var onBack: (() -> Void)?

    @State private var draft = ""
    @FocusState private var composerFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                transcript
                composer
            }
            .background(Palette.background(scheme))
            .navigationTitle("Coach")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                // The way out. A keyboard-accessory "Done" sat directly on top of the
                // send button, so the two were easy to hit by mistake; putting the exit
                // in the nav bar keeps it clear of the composer entirely. Dismisses the
                // keyboard on the way so the tab bar is usable again if you come back.
                if onBack != nil {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            composerFocused = false
                            onBack?()
                        } label: {
                            Label("Dashboard", systemImage: "chevron.left")
                        }
                        .accessibilityLabel("Back to dashboard")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await store.generateNewPlan() }
                    } label: {
                        Image(systemName: "arrow.triangle.2.circlepath")
                    }
                    .disabled(store.coachThinking || store.dashboard == nil || !ai.isUsable)
                    .accessibilityLabel("New plan")
                }
            }
        }
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if store.messages.isEmpty { welcome }
                    ForEach(store.messages) { message in
                        VStack(alignment: .leading, spacing: 8) {
                            Bubble(message: message)
                            if message.pendingAction != nil {
                                ActionConfirmation(
                                    confirm: { Task { await store.confirmAction(message) } },
                                    cancel: { store.cancelAction(message) }
                                )
                            }
                        }
                        .id(message.id)
                    }
                    if store.coachThinking {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            // Naming the actual backend matters: claiming "on device"
                            // while the question is in flight to someone's own Gemini
                            // key is a privacy claim that isn't true.
                            Text(APIKeyStore.shared.activeProvider.map { "Thinking with \($0.label)…" }
                                 ?? "Thinking on device…")
                                .font(.caption).foregroundStyle(Palette.muted(scheme))
                        }
                        .id("thinking")
                    }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: store.messages.count) { _, _ in
                withAnimation { proxy.scrollTo(store.messages.last?.id, anchor: .bottom) }
            }
            .onChange(of: store.messages.last?.text) { _, _ in
                proxy.scrollTo(store.messages.last?.id, anchor: .bottom)
            }
        }
    }

    private var welcome: some View {
        VStack(alignment: .leading, spacing: 12) {
            Panel(title: "Fuel AI") {
                Text("Ask about your meals, macros, sleep, workouts or trends — the coach can see your whole dashboard. Tap the plan button above for a plan for the rest of your day.")
                    .font(.footnote).foregroundStyle(Palette.muted(scheme))
                if case .unavailable(let why) = ai.availability, !ai.isUsable {
                    // Only the genuinely-stuck case gets the warning treatment — on-device
                    // being unavailable is not a problem if a remote key covers it.
                    Divider()
                    Text(why).font(.caption).foregroundStyle(.orange)
                    Button("Check again") { ai.refreshAvailability() }.buttonStyle(.bordered)
                } else {
                    Divider()
                    Text(APIKeyStore.shared.activeProvider.map { "Using your own \($0.label) key." }
                         ?? "Runs entirely on this iPhone. Nothing is sent to a model provider.")
                        .font(.caption).foregroundStyle(Palette.muted(scheme))
                }
            }
            ForEach(Self.starters, id: \.self) { starter in
                Button {
                    Task { await store.askCoach(starter) }
                } label: {
                    HStack {
                        Text(starter).font(.system(size: 14)).multilineTextAlignment(.leading)
                        Spacer()
                        Image(systemName: "arrow.up.right").font(.caption)
                    }
                    .padding(12)
                    .background(Palette.panel(scheme))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.border(scheme), lineWidth: 1))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Palette.ink(scheme))
                .disabled(!ai.isUsable || store.dashboard == nil)
            }
        }
    }

    private static let starters = [
        "How is my day going so far?",
        "Am I on track for my protein goal?",
        "What should I eat for dinner?",
        "How does this week compare to last week?",
    ]

    private var composer: some View {
        HStack(spacing: 10) {
            TextField("Ask anything about your data…", text: $draft, axis: .vertical)
                .focused($composerFocused)
                .font(.system(size: 15))
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(Palette.panel(scheme))
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .overlay(RoundedRectangle(cornerRadius: 20).stroke(Palette.border(scheme), lineWidth: 1))
                .lineLimit(1...5)

            Button {
                let question = draft.trimmingCharacters(in: .whitespacesAndNewlines)
                draft = ""
                Task { await store.askCoach(question) }
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(DashboardTheme.shared.accent, in: Circle())
            }
            .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty
                      || store.coachThinking || !ai.isUsable)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.bar)
    }
}

/// The gate between the model proposing a change and the app making it. Nothing the
/// Coach decides is applied until this is tapped — a wrong number in a food log is easy
/// for a model to produce and tedious for a person to find later.
private struct ActionConfirmation: View {
    @Environment(\.colorScheme) private var scheme
    let confirm: () -> Void
    let cancel: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Button(action: confirm) {
                Text("Confirm")
                    .font(.system(size: 14, weight: .semibold))
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(DashboardTheme.shared.accent, in: Capsule())
                    .foregroundStyle(.white)
            }
            Button(action: cancel) {
                Text("Cancel")
                    .font(.system(size: 14, weight: .medium))
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .background(Palette.surface(scheme), in: Capsule())
                    .foregroundStyle(Palette.muted(scheme))
            }
            Spacer(minLength: 0)
        }
        .buttonStyle(.plain)
        .padding(.leading, 2)
    }
}

private struct Bubble: View {
    @Environment(\.colorScheme) private var scheme
    let message: ChatMessage

    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 40) }
            VStack(alignment: message.role == .user ? .trailing : .leading, spacing: 8) {
                if let photo = message.photo, let image = UIImage(data: photo) {
                    Image(uiImage: image)
                        .resizable().scaledToFill()
                        .frame(width: 150, height: 110).clipped()
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                if !message.text.isEmpty {
                    // Only the coach's own replies are markdown; whatever the person
                    // typed is shown exactly as typed.
                    Group {
                        if message.role == .user {
                            Text(message.text).foregroundStyle(.white)
                        } else {
                            MarkdownText(text: message.text, color: Palette.ink(scheme))
                        }
                    }
                        .font(.system(size: 15))
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(
                            message.role == .user
                                ? AnyShapeStyle(DashboardTheme.shared.accent)
                                : AnyShapeStyle(Palette.panel(scheme))
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 16, style: .continuous)
                                .stroke(message.role == .user ? .clear : Palette.border(scheme), lineWidth: 1)
                        )
                }
            }
            if message.role == .coach { Spacer(minLength: 40) }
        }
    }
}
