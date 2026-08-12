import SwiftUI
import AVFoundation
import UIKit

// Log opens straight into the back camera, because the fastest possible path from
// "I am eating this" to a logged entry is: open app, tap once. Typing is still there,
// one tap away, for the times there is nothing to point a camera at.
//
// Two shutter buttons. The big one captures and sends the photo straight to the
// on-device model. The blue one captures and stops to let you add context first —
// "half of this", "with extra rice" — which is the difference between a guess and a
// good estimate.

// MARK: - Camera plumbing

@MainActor
@Observable
final class Camera: NSObject, AVCapturePhotoCaptureDelegate {
    let session = AVCaptureSession()
    private let output = AVCapturePhotoOutput()
    private var configured = false
    private var onCapture: ((Data) -> Void)?

    /// Nil until the camera is actually usable; the simulator has no camera, so the UI
    /// has to have something honest to show.
    private(set) var unavailable: String?

    func start() {
        guard !configured else {
            if !session.isRunning { Task.detached { [session] in session.startRunning() } }
            return
        }
        configured = true
        session.beginConfiguration()
        session.sessionPreset = .photo
        // Back camera by default: you are photographing the plate, not yourself.
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input), session.canAddOutput(output) else {
            session.commitConfiguration()
            unavailable = "No camera on this device. Use Manual instead."
            return
        }
        session.addInput(input)
        session.addOutput(output)
        session.commitConfiguration()
        Task.detached { [session] in session.startRunning() }
    }

    func stop() {
        guard session.isRunning else { return }
        Task.detached { [session] in session.stopRunning() }
    }

    func capture(_ completion: @escaping (Data) -> Void) {
        guard unavailable == nil else { return }
        onCapture = completion
        output.capturePhoto(with: AVCapturePhotoSettings(), delegate: self)
    }

    nonisolated func photoOutput(_ output: AVCapturePhotoOutput,
                                 didFinishProcessingPhoto photo: AVCapturePhoto,
                                 error: Error?) {
        guard let data = photo.fileDataRepresentation() else { return }
        Task { @MainActor in
            onCapture?(data)
            onCapture = nil
        }
    }
}

struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.layer.session = session
        view.layer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {}

    final class PreviewView: UIView {
        override static var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        override var layer: AVCaptureVideoPreviewLayer { super.layer as! AVCaptureVideoPreviewLayer }
    }
}

// MARK: - The screen

struct CameraLogView: View {
    @Environment(AppStore.self) private var store
    @Environment(OnDeviceAI.self) private var ai
    @Environment(\.colorScheme) private var scheme

    @State private var camera = Camera()
    @State private var typing = false
    @State private var pendingPhoto: Data?
    @State private var contextNote = ""
    @State private var askingForContext = false
    /// The frame that was actually captured, held on screen from the moment the shutter
    /// fires until the log lands. Without it the preview keeps showing live video while
    /// the model reads a photo you can no longer see — so you cannot tell what was sent,
    /// or whether the shot you got is the shot you meant.
    @State private var frozen: Data?

    var body: some View {
        ZStack {
            if typing {
                ManualLogView(onClose: { typing = false })
                    .transition(.move(edge: .bottom))
            } else {
                cameraScreen
            }
        }
        .animation(.snappy, value: typing)
        .onAppear { camera.start() }
        .onDisappear { camera.stop() }
        .sheet(isPresented: $askingForContext) { contextSheet }
    }

    private var cameraScreen: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let frozen, let image = UIImage(data: frozen) {
                Image(uiImage: image)
                    .resizable().scaledToFill()
                    .ignoresSafeArea()
                    .overlay(Color.black.opacity(store.logging ? 0.25 : 0))
            } else if camera.unavailable == nil {
                CameraPreview(session: camera.session).ignoresSafeArea()
            } else {
                VStack(spacing: 12) {
                    Image(systemName: "camera.metering.unknown").font(.system(size: 40))
                    Text(camera.unavailable ?? "").font(.footnote)
                }
                .foregroundStyle(.white.opacity(0.7))
            }

            VStack {
                HStack {
                    Spacer()
                    Button {
                        typing = true
                    } label: {
                        Label("Manual", systemImage: "square.and.pencil")
                            .font(.system(size: 15, weight: .medium))
                            .padding(.horizontal, 14).padding(.vertical, 9)
                            .background(.ultraThinMaterial, in: Capsule())
                    }
                }
                .padding(.horizontal, 18)
                .padding(.top, 8)

                Spacer()

                if store.logging {
                    HStack(spacing: 10) {
                        ProgressView().tint(.white)
                        Text(APIKeyStore.shared.activeProvider.map { "Reading your photo with \($0.label)…" }
                             ?? "Reading your photo on device…")
                            .foregroundStyle(.white)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 11)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.bottom, 16)
                }

                if let logged = store.lastLogged {
                    Text("Logged \(logged)")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16).padding(.vertical, 11)
                        .background(.ultraThinMaterial, in: Capsule())
                        .padding(.bottom, 16)
                        .transition(.opacity)
                }

                shutterRow.padding(.bottom, 26)
            }
        }
    }

    private var shutterRow: some View {
        HStack(spacing: 34) {
            // Symmetry placeholder so the shutter stays centred.
            Circle().fill(.clear).frame(width: 52, height: 52)

            Button {
                camera.capture { data in
                    frozen = data
                    Task {
                        await store.logPhoto(data, note: nil)
                        frozen = nil
                    }
                }
            } label: {
                ZStack {
                    Circle().stroke(.white, lineWidth: 4).frame(width: 76, height: 76)
                    Circle().fill(.white).frame(width: 62, height: 62)
                }
            }
            .disabled(camera.unavailable != nil || store.logging)

            // Same capture, but stop and let them say what the model cannot see.
            Button {
                camera.capture { data in
                    pendingPhoto = data
                    frozen = data
                    askingForContext = true
                }
            } label: {
                ZStack {
                    Circle().fill(Color.accentColorBlue).frame(width: 52, height: 52)
                    Image(systemName: "text.bubble.fill").foregroundStyle(.white)
                }
            }
            .disabled(camera.unavailable != nil || store.logging)
        }
    }

    private var contextSheet: some View {
        NavigationStack {
            VStack(spacing: 16) {
                // The shot itself, so the note you write is about the plate you actually
                // photographed rather than the one you remember photographing.
                if let pendingPhoto, let image = UIImage(data: pendingPhoto) {
                    Image(uiImage: image)
                        .resizable().scaledToFill()
                        .frame(height: 96)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                Text("Anything the photo doesn't show?")
                    .font(.system(size: 17, weight: .semibold))
                TextField("e.g. half portion, oat milk, extra rice", text: $contextNote, axis: .vertical)
                    .padding(12)
                    .background(Palette.surface(scheme))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                Button {
                    let photo = pendingPhoto
                    let note = contextNote
                    askingForContext = false
                    contextNote = ""
                    pendingPhoto = nil
                    if let photo {
                        Task {
                            await store.logPhoto(photo, note: note)
                            frozen = nil
                        }
                    } else { frozen = nil }
                } label: {
                    Text("Log it").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                Spacer()
            }
            .padding(20)
            .navigationTitle("Add context")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        askingForContext = false
                        contextNote = ""
                        pendingPhoto = nil
                        frozen = nil
                    }
                }
            }
        }
        .presentationDetents([.height(380)])
    }
}

extension Color {
    /// The one blue in the app — the secondary shutter, so it reads as a different
    /// action rather than a second primary one.
    static let accentColorBlue = Color(hex: 0x0A84FF)
}

/// The manual path, made genuinely manual. The camera route hands the whole problem to
/// a model; this one hands it to you. Three ways in, in order of how often they get
/// used: tap a common food and every number is filled from published values, type and
/// take an autocomplete match, or write the numbers yourself. The AI estimate is still
/// here, but it is now one option among three rather than the only way to get macros.
struct ManualLogView: View {
    @Environment(AppStore.self) private var store
    @Environment(OnDeviceAI.self) private var ai
    @Environment(\.colorScheme) private var scheme
    var onClose: () -> Void

    @State private var food = ""
    @State private var portion = ""
    @State private var meal = "lunch"
    @State private var estimating = false
    @State private var browsing = false
    /// Nutrition as strings, because a half-typed number is not a Double and blanking a
    /// field has to mean "unknown" rather than snapping back to 0.
    @State private var calories = ""
    @State private var protein = ""
    @State private var carbs = ""
    @State private var fat = ""
    @State private var fiber = ""
    @FocusState private var foodFocused: Bool

    private let meals = ["breakfast", "lunch", "dinner", "snack"]

    private var suggestions: [CommonFood] {
        guard foodFocused else { return [] }
        let hits = CommonFoods.matches(food)
        // One exact hit that is already in the field is not a suggestion.
        if hits.count == 1, hits[0].name.lowercased() == food.lowercased() { return [] }
        return hits
    }

    private var nutrition: EstimatedNutrition? {
        let n = EstimatedNutrition(calories: Double(calories), protein: Double(protein),
                                   carbs: Double(carbs), fat: Double(fat), fiber: Double(fiber))
        return n.calories == nil && n.protein == nil && n.carbs == nil && n.fat == nil && n.fiber == nil ? nil : n
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    Panel(title: "What did you eat?") {
                        TextField("e.g. chicken burrito bowl", text: $food, axis: .vertical)
                            .focused($foodFocused)
                            .padding(12).background(Palette.surface(scheme))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        ForEach(suggestions) { hit in
                            Button { apply(hit) } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(hit.name).font(.system(size: 15))
                                        Text(hit.portion).font(.system(size: 12)).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text(Format.kcal(hit.calories)).font(.system(size: 13)).foregroundStyle(.secondary)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(Palette.ink(scheme))
                        }
                        TextField("Portion (optional)", text: $portion)
                            .padding(12).background(Palette.surface(scheme))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        Picker("Meal", selection: $meal) {
                            ForEach(meals, id: \.self) { Text($0.capitalized).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        Button { browsing = true } label: {
                            Label("Browse common foods", systemImage: "list.bullet")
                                .font(.system(size: 14))
                        }
                    }

                    Panel(title: "Nutrition",
                          subtitle: "Fill in what you know — anything left blank is logged as unknown, not as zero.") {
                        field("Calories", "kcal", $calories)
                        field("Protein", "g", $protein)
                        field("Carbs", "g", $carbs)
                        field("Fat", "g", $fat)
                        field("Fiber", "g", $fiber)

                        Button {
                            Task {
                                estimating = true
                                let e = try? await ai.estimateNutrition(food: food, portion: portion.isEmpty ? nil : portion)
                                if let e { fill(e) }
                                estimating = false
                            }
                        } label: {
                            HStack {
                                if estimating { ProgressView().controlSize(.small) } else { Image(systemName: "sparkles") }
                                Text(estimating ? "Estimating…" : "Estimate with AI")
                            }.frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .disabled(estimating || food.isEmpty || !ai.isUsable)
                    }

                    Button {
                        Task {
                            await store.logFood(description: food, meal: meal,
                                                portion: portion.isEmpty ? nil : portion, nutrition: nutrition)
                            onClose()
                        }
                    } label: { Text("Log it").frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent)
                    .disabled(food.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(16)
            }
            .background(Palette.background(scheme))
            .navigationTitle("Manual Entry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { onClose() } label: { Label("Camera", systemImage: "camera.fill") }
                }
            }
            .sheet(isPresented: $browsing) {
                CommonFoodPicker { hit in
                    apply(hit)
                    browsing = false
                }
            }
        }
    }

    private func field(_ label: String, _ unit: String, _ value: Binding<String>) -> some View {
        HStack {
            Text(label).font(.system(size: 15))
            Spacer()
            TextField("—", text: value)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 84)
            Text(unit).font(.system(size: 13)).foregroundStyle(.secondary).frame(width: 30, alignment: .leading)
        }
        .padding(.vertical, 2)
    }

    private func apply(_ hit: CommonFood) {
        food = hit.name
        if portion.isEmpty { portion = hit.portion }
        fill(hit.nutrition)
        foodFocused = false
    }

    private func fill(_ n: EstimatedNutrition) {
        func text(_ v: Double?) -> String { v.map { Format.number($0) } ?? "" }
        calories = text(n.calories)
        protein = text(n.protein)
        carbs = text(n.carbs)
        fat = text(n.fat)
        fiber = text(n.fiber)
    }
}

/// The scrollable list of common foods, grouped the way a menu is. Everything here logs
/// without a model call, which is the point: the fastest manual entry is one tap.
struct CommonFoodPicker: View {
    @Environment(\.dismiss) private var dismiss
    var onPick: (CommonFood) -> Void
    @State private var search = ""

    private var shown: [(String, [CommonFood])] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        return CommonFoods.groups.compactMap { group in
            let items = CommonFoods.all.filter {
                $0.group == group && (q.isEmpty || $0.name.lowercased().contains(q))
            }
            return items.isEmpty ? nil : (group, items)
        }
    }

    var body: some View {
        NavigationStack {
            List {
                ForEach(shown, id: \.0) { group, items in
                    Section(group) {
                        ForEach(items) { item in
                            Button { onPick(item) } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(item.name)
                                        Text(item.portion).font(.system(size: 12)).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    VStack(alignment: .trailing, spacing: 2) {
                                        Text(Format.kcal(item.calories)).font(.system(size: 14, weight: .medium))
                                        Text("P \(Format.number(item.protein)) · C \(Format.number(item.carbs)) · F \(Format.number(item.fat))")
                                            .font(.system(size: 11)).foregroundStyle(.secondary)
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .searchable(text: $search, prompt: "Search common foods")
            .navigationTitle("Common foods")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}
