import SwiftUI

// Blood test results: every panel you have logged, newest first, with each result read
// against the reference range the lab printed beside it and explained in a sentence of
// plain physiology (see BloodMarkers).
//
// Two deliberate limits. The app never tells you what a result means for you — it says
// what the marker measures, what the lab's range was, and whether the number fell
// outside it, which is arithmetic rather than judgement. And nothing is transcribed by
// hand: you paste the report in whatever shape it arrived and the model copies it
// across, because retyping thirty numbers is exactly where transcription errors come
// from.

struct BloodView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme
    @State private var logging = false

    var body: some View {
        Group {
            if store.bloodPanels.isEmpty {
                emptyState
            } else {
                List {
                    if let error = store.bloodError {
                        Section {
                            Label(error, systemImage: "exclamationmark.triangle")
                                .font(.footnote).foregroundStyle(.orange)
                        }
                    }
                    ForEach(store.bloodPanels) { panel in
                        Section {
                            NavigationLink { BloodPanelDetail(panel: panel) } label: { panelRow(panel) }
                        }
                    }
                    Section {
                        disclaimer
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle("Blood results")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { logging = true } label: { Label("Log results", systemImage: "plus") }
            }
        }
        .task { await store.loadBloodPanels() }
        .refreshable { await store.loadBloodPanels() }
        .sheet(isPresented: $logging) { LogBloodPanelSheet() }
    }

    private var emptyState: some View {
        ScrollView {
            VStack(spacing: 14) {
                Panel(title: "No results yet") {
                    Text("Paste a lab report — any shape, straight out of a portal or a PDF — and Fuel will read it into a panel you can look back at.")
                        .font(.footnote).foregroundStyle(Palette.muted(scheme))
                    Button { logging = true } label: {
                        Label("Log blood test results", systemImage: "plus.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .padding(.top, 4)
                }
                Panel { disclaimer }
            }
            .padding(16)
        }
        .background(Palette.background(scheme))
    }

    private var disclaimer: some View {
        Text("Fuel shows what each marker measures and whether a value fell outside the range your lab printed. It does not interpret your results — that is a conversation for whoever ordered the test.")
            .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
    }

    private func panelRow(_ panel: BloodPanel) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(BloodFormat.date(panel.collectedOn) ?? "Undated panel")
                    .font(.system(size: 16, weight: .semibold)).foregroundStyle(Palette.ink(scheme))
                Spacer()
                let flagged = panel.outOfRange.count
                if flagged > 0 {
                    Text("\(flagged) outside range")
                        .font(.system(size: 11, weight: .medium))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Capsule().fill(Color.orange.opacity(0.18)))
                        .foregroundStyle(.orange)
                }
            }
            Text([panel.lab, "\(panel.markers.count) result\(panel.markers.count == 1 ? "" : "s")"]
                .compactMap { $0 }.joined(separator: " · "))
                .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
        }
        .padding(.vertical, 2)
    }
}

/// One panel, grouped by which body system its markers belong to, because a report that
/// mixes a blood count with a metabolic panel is two different questions printed on one
/// page.
struct BloodPanelDetail: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    let panel: BloodPanel
    @State private var confirmingDelete = false
    @State private var editing = false

    /// The stored copy, so an edit made in the sheet is reflected here rather than
    /// leaving this screen showing what the panel looked like when it was opened.
    private var current: BloodPanel { store.bloodPanels.first { $0.id == panel.id } ?? panel }

    private var grouped: [(category: String, markers: [BloodPanel.Marker])] {
        let buckets = Dictionary(grouping: current.markers) { BloodMarkers.category(for: $0.name) }
        return BloodMarkers.categories.compactMap { category in
            guard let markers = buckets[category], !markers.isEmpty else { return nil }
            return (category, markers)
        }
    }

    var body: some View {
        List {
            if !current.outOfRange.isEmpty {
                Section {
                    ForEach(current.outOfRange) { marker in
                        HStack {
                            Image(systemName: marker.isHigh ? "arrow.up.circle.fill" : "arrow.down.circle.fill")
                                .foregroundStyle(.orange)
                            Text(marker.name).font(.system(size: 14))
                            Spacer()
                            Text(marker.displayValue).font(.system(size: 14, weight: .medium))
                        }
                    }
                } header: {
                    Text("Outside the lab's range")
                } footer: {
                    Text("Outside a reference range is not the same as a problem — ranges are set so that a share of healthy people fall outside them. Bring these to whoever ordered the test.")
                }
            }

            ForEach(grouped, id: \.category) { group in
                Section(group.category) {
                    ForEach(group.markers) { marker in
                        BloodMarkerRow(marker: marker)
                    }
                }
            }

            Section {
                Button(role: .destructive) { confirmingDelete = true } label: {
                    Label("Delete this panel", systemImage: "trash")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(BloodFormat.date(current.collectedOn) ?? "Blood results")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) { Button("Edit") { editing = true } }
        }
        .sheet(isPresented: $editing) { EditBloodPanelSheet(panel: current) }
        .confirmationDialog("Delete this panel?", isPresented: $confirmingDelete) {
            Button("Delete", role: .destructive) {
                Task { await store.deleteBloodPanel(panel); dismiss() }
            }
        } message: {
            Text("The results in it are removed for good.")
        }
    }
}

/// One result: the number, the lab's range, and what the marker actually is. The
/// explanation is collapsed by default — thirty expanded paragraphs is not a report.
struct BloodMarkerRow: View {
    @Environment(\.colorScheme) private var scheme
    let marker: BloodPanel.Marker
    @State private var expanded = false

    private var info: BloodMarkerInfo? { BloodMarkers.info(for: marker.name) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(.easeInOut(duration: 0.18)) { expanded.toggle() }
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(marker.name).font(.system(size: 15)).foregroundStyle(Palette.ink(scheme))
                        if let range = marker.displayRange {
                            Text("Lab range \(range)")
                                .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                        }
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 2) {
                        Text(marker.displayValue)
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(marker.isOutOfRange ? .orange : Palette.ink(scheme))
                        if marker.isOutOfRange {
                            Text(marker.isHigh ? "Above range" : "Below range")
                                .font(.system(size: 10, weight: .medium)).foregroundStyle(.orange)
                        }
                    }
                    if info != nil {
                        Image(systemName: expanded ? "chevron.up" : "chevron.down")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Palette.muted(scheme))
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(info == nil)

            if marker.value != nil, marker.referenceLow != nil || marker.referenceHigh != nil {
                BloodRangeBar(marker: marker)
            }

            if expanded, let info {
                VStack(alignment: .leading, spacing: 6) {
                    Text(info.meaning).font(.system(size: 12)).foregroundStyle(Palette.ink(scheme))
                    if let influences = info.influences {
                        Text(influences).font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                    }
                    Text("Source: \(info.source)")
                        .font(.system(size: 10)).foregroundStyle(Palette.muted(scheme))
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.surface(scheme))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .transition(.opacity)
            }
        }
        .padding(.vertical, 2)
    }
}

/// Paste the report, in whatever shape it arrived. Nothing is typed twice.
struct LogBloodPanelSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(OnDeviceAI.self) private var ai
    @Environment(\.colorScheme) private var scheme

    @State private var report = ""
    @State private var saving = false
    @State private var failure: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Panel(title: "Paste your results",
                          subtitle: "Straight from the lab portal, an email, or a PDF. Columns can be jumbled or wrapped — it gets sorted out.") {
                        TextEditor(text: $report)
                            .font(.system(size: 13, design: .monospaced))
                            .frame(minHeight: 240)
                            .padding(8)
                            .background(Palette.surface(scheme))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                            .overlay(alignment: .topLeading) {
                                if report.isEmpty {
                                    Text("Test Name   Result   Flags   Reference Range\n…")
                                        .font(.system(size: 13, design: .monospaced))
                                        .foregroundStyle(Palette.muted(scheme))
                                        .padding(16)
                                        .allowsHitTesting(false)
                                }
                            }
                    }

                    if let failure {
                        Panel { Text(failure).font(.footnote).foregroundStyle(.orange) }
                    }

                    Panel {
                        Text("The reading happens \(ai.isUsable ? (APIKeyStore.shared.activeProvider?.label ?? "on this iPhone") : "on this iPhone") and only copies what the report says — no value is estimated, converted or corrected.")
                            .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                    }
                }
                .padding(16)
            }
            .background(Palette.background(scheme))
            .navigationTitle("Log blood results")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        saving = true
                        failure = nil
                        Task {
                            let ok = await store.saveBloodPanel(fromReport: report)
                            saving = false
                            if ok { dismiss() } else { failure = store.bloodError ?? "That couldn't be read." }
                        }
                    } label: {
                        if saving { ProgressView().controlSize(.small) } else { Text("Save") }
                    }
                    .disabled(saving || report.trimmingCharacters(in: .whitespacesAndNewlines).count < 10 || !ai.isUsable)
                }
            }
        }
    }
}

/// Where a value sits against the range the lab printed. The band is the reference
/// range; the dot is the result. Same reading as the Compare bars on Trends, and for the
/// same reason: a number and a range as two pieces of text take a moment to compare,
/// while a dot inside or outside a band takes none.
struct BloodRangeBar: View {
    @Environment(\.colorScheme) private var scheme
    let marker: BloodPanel.Marker

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            // A one-sided range ("<150") still draws: the missing end becomes the edge of
            // the plot rather than dropping the bar entirely.
            let low = marker.referenceLow ?? min(marker.value ?? 0, marker.referenceHigh ?? 0)
            let high = marker.referenceHigh ?? max(marker.value ?? 0, low)
            let value = marker.value ?? low
            let spread = max(high - low, 0.0001)
            // Room either side so an in-range value is visibly inside rather than flush
            // against an edge, widened when the result falls outside the band.
            let domainMin = min(low - spread * 0.35, value - spread * 0.12)
            let domainMax = max(high + spread * 0.35, value + spread * 0.12)
            let domain = max(domainMax - domainMin, 0.0001)
            let position: (Double) -> CGFloat = { CGFloat(($0 - domainMin) / domain) * width }

            ZStack(alignment: .leading) {
                Capsule().fill(Palette.surface(scheme)).frame(height: 6)
                Capsule()
                    .fill(inBandColor.opacity(0.35))
                    .frame(width: max(2, position(high) - position(low)), height: 6)
                    .offset(x: position(low))
                Circle()
                    .fill(marker.isOutOfRange ? Color.orange : inBandColor)
                    .frame(width: 11, height: 11)
                    .overlay(Circle().stroke(Palette.panel(scheme), lineWidth: 1.5))
                    .offset(x: position(value) - 5.5)
            }
        }
        .frame(height: 12)
        .padding(.top, 2)
        .accessibilityLabel("\(marker.name) \(marker.displayValue)")
        .accessibilityValue(marker.isOutOfRange
                            ? (marker.isHigh ? "above the lab range" : "below the lab range")
                            : "within the lab range")
    }

    private var inBandColor: Color { DashboardTheme.shared.accent }
}

/// Correcting a panel: its date, the lab it came from, a note, and the results
/// themselves. Transcription is the step most likely to go wrong — a model reading a
/// smudged PDF column can drop a decimal — so every field it produced is editable rather
/// than final.
struct EditBloodPanelSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var scheme
    let panel: BloodPanel

    @State private var lab: String
    @State private var notes: String
    @State private var hasDate: Bool
    @State private var date: Date
    @State private var markers: [BloodPanel.Marker]
    @State private var saving = false

    init(panel: BloodPanel) {
        self.panel = panel
        _lab = State(initialValue: panel.lab ?? "")
        _notes = State(initialValue: panel.notes ?? "")
        let parsed = panel.collectedOn.flatMap { BloodFormat.parse($0) }
        _hasDate = State(initialValue: parsed != nil)
        _date = State(initialValue: parsed ?? Date())
        _markers = State(initialValue: panel.markers)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Lab or clinic", text: $lab)
                    Toggle("Panel has a date", isOn: $hasDate.animation())
                    if hasDate {
                        DatePicker("Collected", selection: $date, displayedComponents: .date)
                    }
                } header: {
                    Text("Panel")
                } footer: {
                    Text("A report that never stated a draw date stays undated rather than being given today's.")
                }

                Section("Notes") {
                    TextField("Anything worth remembering about this draw", text: $notes, axis: .vertical)
                        .lineLimit(2...6)
                }

                Section {
                    ForEach(markers.indices, id: \.self) { index in
                        NavigationLink { EditBloodMarkerView(marker: $markers[index]) } label: {
                            HStack {
                                Text(markers[index].name).lineLimit(1)
                                Spacer()
                                Text(markers[index].displayValue)
                                    .font(.system(size: 13))
                                    .foregroundStyle(markers[index].isOutOfRange ? .orange : Palette.muted(scheme))
                            }
                        }
                    }
                    .onDelete { markers.remove(atOffsets: $0) }
                } header: {
                    Text("Results")
                } footer: {
                    Text("Editing a value re-checks it against its range, so a corrected number stops being flagged.")
                }
            }
            .navigationTitle("Edit panel")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        saving = true
                        Task {
                            let ok = await store.updateBloodPanel(
                                panel, collectedOn: hasDate ? BloodFormat.iso(date) : nil,
                                lab: lab, notes: notes, markers: markers)
                            saving = false
                            if ok { dismiss() }
                        }
                    } label: {
                        if saving { ProgressView().controlSize(.small) } else { Text("Save") }
                    }
                    .disabled(saving || markers.isEmpty)
                }
            }
        }
    }
}

/// One result, field by field. The range is editable too, since a mistranscribed range
/// mislabels a perfectly normal value as out of range.
struct EditBloodMarkerView: View {
    @Binding var marker: BloodPanel.Marker

    var body: some View {
        Form {
            Section("Test") {
                TextField("Name", text: $marker.name)
                TextField("Unit", text: Binding(get: { marker.unit ?? "" },
                                                set: { marker.unit = $0.isEmpty ? nil : $0 }))
            }
            Section {
                numberField("Result", value: $marker.value)
                TextField("Reported text (when there is no number)",
                          text: Binding(get: { marker.valueText ?? "" },
                                        set: { marker.valueText = $0.isEmpty ? nil : $0 }))
            } header: {
                Text("Result")
            } footer: {
                Text("A cancelled or pending test keeps its line — leave the number empty and say so here.")
            }
            Section {
                numberField("Range low", value: $marker.referenceLow)
                numberField("Range high", value: $marker.referenceHigh)
                TextField("Range as printed (e.g. Not Estab.)",
                          text: Binding(get: { marker.referenceText ?? "" },
                                        set: { marker.referenceText = $0.isEmpty ? nil : $0 }))
            } header: {
                Text("Reference range")
            } footer: {
                Text("Use the range your own lab printed. Ranges differ between labs, and this one is what your result is read against.")
            }
        }
        .navigationTitle(marker.name.isEmpty ? "Result" : marker.name)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func numberField(_ label: String, value: Binding<Double?>) -> some View {
        HStack {
            Text(label)
            Spacer()
            TextField("—", text: Binding(
                get: { value.wrappedValue.map { String(format: "%g", $0) } ?? "" },
                set: { value.wrappedValue = Double($0) }))
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 110)
        }
    }
}

enum BloodFormat {
    /// "12 August 2026" from an ISO date, or nil when the report never gave one.
    static func date(_ iso: String?) -> String? {
        guard let iso, let parsed = isoFormatter.date(from: iso) else { return nil }
        return display.string(from: parsed)
    }

    static func parse(_ iso: String) -> Date? { isoFormatter.date(from: iso) }
    static func iso(_ date: Date) -> String { isoFormatter.string(from: date) }

    private static let isoFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = .current
        return f
    }()
    private static let display: DateFormatter = {
        let f = DateFormatter()
        f.dateStyle = .long
        return f
    }()
}
