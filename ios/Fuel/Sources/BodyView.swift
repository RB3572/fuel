import SwiftUI
import Charts

// Weight and the other numbers a scale gives you. Reached from the three-dot menu on the
// Log screen, because it is logging — just not of food.
//
// BMI is shown but never stored: it is height and weight arithmetic, and a stored copy
// would be free to disagree with the two numbers it came from. Height comes from the
// profile in Preferences & context, which is where the constants live.

struct BodyView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme
    @State private var logging = false

    private var heightIn: Double? { store.dashboard?.goalProfile?.heightIn }
    private var weighIns: [BodyMeasurement] { store.bodyMeasurements.filter { $0.weightLb != nil } }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 14) {
                if let error = store.bodyError {
                    Panel { Label(error, systemImage: "exclamationmark.triangle").font(.footnote).foregroundStyle(.orange) }
                }
                if store.bodyMeasurements.isEmpty {
                    Panel(title: "Nothing logged yet") {
                        Text("Log a weigh-in by hand, or pull what your scale has already written to Apple Health.")
                            .font(.footnote).foregroundStyle(Palette.muted(scheme))
                    }
                } else {
                    latestCard
                    if weighIns.count > 1 { trendCard }
                    historyCard
                }
            }
            .padding(16)
        }
        .background(Palette.background(scheme))
        .navigationTitle("Body")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { logging = true } label: { Label("Log a measurement", systemImage: "plus") }
                    Button {
                        Task { await store.importBodyMeasurementsFromHealth() }
                    } label: { Label("Import from Apple Health", systemImage: "heart.fill") }
                } label: { Image(systemName: "ellipsis.circle") }
            }
        }
        .task { await store.loadBodyMeasurements() }
        .refreshable { await store.loadBodyMeasurements() }
        .sheet(isPresented: $logging) { LogBodyMeasurementSheet() }
    }

    private var latestCard: some View {
        Panel(title: "Latest") {
            let latest = store.bodyMeasurements.first
            HStack(alignment: .top, spacing: 12) {
                Stat(label: "Weight", value: latest?.weightLb.map { Format.number($0, decimals: 1) + " lb" } ?? "—")
                if let bmi = latest?.bmi(heightIn: heightIn) {
                    Stat(label: "BMI", value: Format.number(bmi, decimals: 1))
                } else {
                    Stat(label: "BMI", value: "—", detail: "Add height in Preferences")
                }
                if let fat = latest?.bodyFatPercent {
                    Stat(label: "Body fat", value: Format.number(fat, decimals: 1) + "%")
                }
            }
        }
    }

    private var trendCard: some View {
        Panel(title: "Weight over time") {
            Chart(weighIns.reversed(), id: \.id) { point in
                if let weight = point.weightLb, let date = BodyFormat.parse(point.recordedAt) {
                    LineMark(x: .value("Date", date), y: .value("lb", weight))
                        .foregroundStyle(DashboardTheme.shared.accent)
                        .interpolationMethod(.monotone)
                    PointMark(x: .value("Date", date), y: .value("lb", weight))
                        .foregroundStyle(DashboardTheme.shared.accent)
                }
            }
            .chartYScale(domain: .automatic(includesZero: false))
            .frame(height: 200)
        }
    }

    private var historyCard: some View {
        Panel(title: "Every reading") {
            VStack(spacing: 0) {
                ForEach(Array(store.bodyMeasurements.enumerated()), id: \.element.id) { index, measurement in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(BodyFormat.display(measurement.recordedAt))
                                .font(.system(size: 14)).foregroundStyle(Palette.ink(scheme))
                            Text(measurement.source ?? "manual")
                                .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                        }
                        Spacer()
                        Text(measurement.weightLb.map { Format.number($0, decimals: 1) + " lb" } ?? "—")
                            .font(.system(size: 14, weight: .medium))
                    }
                    .padding(.vertical, 7)
                    .contentShape(Rectangle())
                    // A context menu rather than a swipe: these rows are inside a card,
                    // not a List, and swipe actions do nothing outside one.
                    .contextMenu {
                        Button(role: .destructive) {
                            Task { await store.deleteBodyMeasurement(measurement) }
                        } label: { Label("Delete this reading", systemImage: "trash") }
                    }
                    if index < store.bodyMeasurements.count - 1 { Divider().opacity(0.4) }
                }
            }
        }
    }
}

/// Everything a fancy scale reports, each optional — a basic one fills in the first
/// field and leaves the rest alone.
struct LogBodyMeasurementSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var weight = ""
    @State private var bodyFat = ""
    @State private var leanMass = ""
    @State private var muscleMass = ""
    @State private var boneMass = ""
    @State private var bodyWater = ""
    @State private var visceralFat = ""
    @State private var waist = ""
    @State private var chest = ""
    @State private var hip = ""
    @State private var when = Date()
    @State private var saving = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Weigh-in") {
                    DatePicker("When", selection: $when)
                    field("Weight", "lb", $weight)
                }
                Section("Body composition") {
                    field("Body fat", "%", $bodyFat)
                    field("Lean mass", "lb", $leanMass)
                    field("Muscle mass", "lb", $muscleMass)
                    field("Bone mass", "lb", $boneMass)
                    field("Body water", "%", $bodyWater)
                    field("Visceral fat", "", $visceralFat)
                }
                Section {
                    field("Waist", "in", $waist)
                    field("Chest", "in", $chest)
                    field("Hips", "in", $hip)
                } header: {
                    Text("Tape measure")
                } footer: {
                    Text("Fill in whatever you have. Everything here is optional, and a blank field is left unrecorded rather than stored as zero.")
                }
            }
            .navigationTitle("Log measurement")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        saving = true
                        Task {
                            var fields: [String: Any] = ["recordedAt": ISO8601DateFormatter().string(from: when)]
                            for (key, text) in [("weightLb", weight), ("bodyFatPercent", bodyFat),
                                                ("leanMassLb", leanMass), ("muscleMassLb", muscleMass),
                                                ("boneMassLb", boneMass), ("bodyWaterPercent", bodyWater),
                                                ("visceralFat", visceralFat), ("waistIn", waist),
                                                ("chestIn", chest), ("hipIn", hip)] {
                                if let value = Double(text) { fields[key] = value }
                            }
                            let ok = await store.saveBodyMeasurement(fields)
                            saving = false
                            if ok { dismiss() }
                        }
                    } label: {
                        if saving { ProgressView().controlSize(.small) } else { Text("Save") }
                    }
                    .disabled(saving || [weight, bodyFat, leanMass, muscleMass, boneMass,
                                         bodyWater, visceralFat, waist, chest, hip].allSatisfy { Double($0) == nil })
                }
            }
        }
    }

    private func field(_ label: String, _ unit: String, _ value: Binding<String>) -> some View {
        HStack {
            Text(label)
            Spacer()
            TextField("—", text: value)
                .keyboardType(.decimalPad).multilineTextAlignment(.trailing).frame(width: 90)
            Text(unit).font(.system(size: 13)).foregroundStyle(.secondary).frame(width: 26, alignment: .leading)
        }
    }
}

enum BodyFormat {
    static func parse(_ iso: String) -> Date? { ISO8601DateFormatter().date(from: iso) }

    static func display(_ iso: String) -> String {
        guard let date = parse(iso) else { return iso }
        return date.formatted(.dateTime.month(.abbreviated).day().year().hour().minute())
    }
}
