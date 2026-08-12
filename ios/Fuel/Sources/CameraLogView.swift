import SwiftUI
import AVFoundation

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
            unavailable = "No camera on this device. Use Type instead."
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
            if camera.unavailable == nil {
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
                        Label("Type", systemImage: "keyboard")
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
                    Task { await store.logPhoto(data, note: nil) }
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
                    if let photo { Task { await store.logPhoto(photo, note: note) } }
                } label: {
                    Text("Log it").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                Spacer()
            }
            .padding(20)
            .navigationTitle("Add context")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.height(260)])
    }
}

extension Color {
    /// The one blue in the app — the secondary shutter, so it reads as a different
    /// action rather than a second primary one.
    static let accentColorBlue = Color(hex: 0x0A84FF)
}

/// The manual path: still here, still complete, just no longer the default.
struct ManualLogView: View {
    @Environment(AppStore.self) private var store
    @Environment(OnDeviceAI.self) private var ai
    @Environment(\.colorScheme) private var scheme
    var onClose: () -> Void

    @State private var food = ""
    @State private var portion = ""
    @State private var meal = "lunch"
    @State private var estimate: EstimatedNutrition?
    @State private var estimating = false

    private let meals = ["breakfast", "lunch", "dinner", "snack"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    Panel(title: "What did you eat?") {
                        TextField("e.g. chicken burrito bowl", text: $food, axis: .vertical)
                            .padding(12).background(Palette.surface(scheme))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        TextField("Portion (optional)", text: $portion)
                            .padding(12).background(Palette.surface(scheme))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        Picker("Meal", selection: $meal) {
                            ForEach(meals, id: \.self) { Text($0.capitalized).tag($0) }
                        }
                        .pickerStyle(.segmented)
                    }

                    if let estimate {
                        Panel(title: "Estimate",
                              subtitle: (APIKeyStore.shared.activeProvider?.label ?? "On-device")
                                        + " — edit anything that looks wrong") {
                            HStack(alignment: .top, spacing: 8) {
                                Stat(label: "kcal", value: Format.kcal(estimate.calories))
                                Stat(label: "Protein", value: Format.number(estimate.protein))
                                Stat(label: "Carbs", value: Format.number(estimate.carbs))
                                Stat(label: "Fat", value: Format.number(estimate.fat))
                            }
                        }
                    }

                    Button {
                        Task {
                            estimating = true
                            estimate = try? await ai.estimateNutrition(food: food, portion: portion.isEmpty ? nil : portion)
                            estimating = false
                        }
                    } label: {
                        HStack {
                            if estimating { ProgressView().controlSize(.small) } else { Image(systemName: "sparkles") }
                            Text(estimating ? "Estimating…" : "Estimate nutrition")
                        }.frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(estimating || food.isEmpty || !ai.isUsable)

                    Button {
                        Task {
                            await store.logFood(description: food, meal: meal,
                                                portion: portion.isEmpty ? nil : portion, nutrition: estimate)
                            onClose()
                        }
                    } label: { Text("Log it").frame(maxWidth: .infinity) }
                    .buttonStyle(.borderedProminent)
                    .disabled(food.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(16)
            }
            .background(Palette.background(scheme))
            .navigationTitle("Log by hand")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { onClose() } label: { Label("Camera", systemImage: "camera.fill") }
                }
            }
        }
    }
}
