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

    private var grouped: [(category: String, markers: [BloodPanel.Marker])] {
        let buckets = Dictionary(grouping: panel.markers) { BloodMarkers.category(for: $0.name) }
        return BloodMarkers.categories.compactMap { category in
            guard let markers = buckets[category], !markers.isEmpty else { return nil }
            return (category, markers)
        }
    }

    var body: some View {
        List {
            if !panel.outOfRange.isEmpty {
                Section {
                    ForEach(panel.outOfRange) { marker in
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
        .navigationTitle(BloodFormat.date(panel.collectedOn) ?? "Blood results")
        .navigationBarTitleDisplayMode(.inline)
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

enum BloodFormat {
    /// "12 August 2026" from an ISO date, or nil when the report never gave one.
    static func date(_ iso: String?) -> String? {
        guard let iso, let parsed = isoFormatter.date(from: iso) else { return nil }
        return display.string(from: parsed)
    }

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
