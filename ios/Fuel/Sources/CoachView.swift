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
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await store.generateNewPlan() }
                    } label: {
                        Image(systemName: "arrow.triangle.2.circlepath")
                    }
                    .disabled(store.coachThinking || store.dashboard == nil || !ai.availability.isReady)
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
                        Bubble(message: message).id(message.id)
                    }
                    if store.coachThinking {
                        HStack(spacing: 8) {
                            ProgressView().controlSize(.small)
                            Text("Thinking on device…")
                                .font(.caption).foregroundStyle(Palette.muted(scheme))
                        }
                        .id("thinking")
                    }
                }
                .padding(16)
            }
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
                if case .unavailable(let why) = ai.availability {
                    Divider()
                    Text(why).font(.caption).foregroundStyle(.orange)
                    Button("Check again") { ai.refreshAvailability() }.buttonStyle(.bordered)
                } else {
                    Divider()
                    Text("Runs entirely on this iPhone. Nothing is sent to a model provider.")
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
                .disabled(!ai.availability.isReady || store.dashboard == nil)
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
                    .background(Palette.flame, in: Circle())
            }
            .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty
                      || store.coachThinking || !ai.availability.isReady)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.bar)
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
                    Text(message.text)
                        .font(.system(size: 15))
                        .foregroundStyle(message.role == .user ? .white : Palette.ink(scheme))
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .background(
                            message.role == .user
                                ? AnyShapeStyle(Palette.flame)
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
