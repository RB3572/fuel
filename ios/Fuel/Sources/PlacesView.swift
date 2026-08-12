import SwiftUI
import MapKit
import CoreLocation

// The website's Places tab (src/PlacesPage.tsx + src/PlaceMap.tsx): a 24-hour heatmap
// of where the day is spent, built from location fixes taken once per app open. The
// website hand-rolls an OpenStreetMap tile mosaic for the rename preview because it
// has no first-party map; the app has MapKit for free, so the rename sheet below uses
// a native Map instead — same purpose ("which spot is this?"), simpler and smoother
// than reimplementing tile math.

private let placeColors: [Color] = [0x1b1035, 0x4a1079, 0x7d1e6d, 0xa92e5e, 0xcf4446, 0xe96a25, 0xf79711, 0xf7c93e].map { Color(hex: $0) }
private let placeColorOrder = [0, 7, 3, 5, 1, 6, 2, 4]
private let placeNoData = Color(hex: 0xe5ded6)
private let placeOtherColor = Color(hex: 0x9c8f84)
private func placeColor(at index: Int) -> Color { placeColors[placeColorOrder[index % placeColorOrder.count]] }

private func clockLabel(_ minute: Int) -> String {
    let h = (minute / 60) % 24
    let m = minute % 60
    let suffix = h < 12 ? "am" : "pm"
    let hour12 = h % 12 == 0 ? 12 : h % 12
    return m == 0 ? "\(hour12)\(suffix)" : "\(hour12):\(String(format: "%02d", m))\(suffix)"
}

struct PlacesView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme
    @State private var tracking = LocationSampler.shared.trackingEnabled
    @State private var editingPlace: Place?
    @State private var busy = false
    @State private var showDeleteConfirm = false

    private var heatmap: PlaceHeatmap? { store.places }
    private var places: [Place] { heatmap?.places ?? [] }
    private var hasData: Bool { (heatmap?.totalSamples ?? 0) > 0 }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                header
                if hasData {
                    timelinePanel
                    legendPanel
                } else {
                    Panel(title: "No places yet") {
                        Text("Fuel records a single location fix each time you open the app (at most once every few minutes). After a day or two of normal use, this page will show which places fill which parts of your day.")
                            .font(.system(size: 13)).foregroundStyle(Palette.muted(scheme))
                    }
                }
                privacyPanel
            }
            .padding(16)
        }
        .background(Palette.background(scheme))
        .navigationTitle("Places")
        .task {
            await store.loadPlaces()
            await store.identifyPendingPlaces()
        }
        .refreshable { await store.loadPlaces() }
        .sheet(item: $editingPlace) { place in
            RenamePlaceSheet(place: place, index: places.firstIndex(where: { $0.id == place.id }) ?? 0)
        }
        .confirmationDialog(
            "Delete all stored location history? Your places and the heatmap will be erased. This cannot be undone.",
            isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("Delete everything", role: .destructive) {
                Task { busy = true; await store.clearPlaces(); busy = false }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    private var header: some View {
        Panel {
            Text("Where you spend your day").font(.system(size: 18, weight: .bold, design: .rounded)).foregroundStyle(Palette.ink(scheme))
            Text(headerSubtitle).font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
            Toggle(isOn: Binding(
                get: { tracking },
                set: { value in
                    tracking = value
                    LocationSampler.shared.trackingEnabled = value
                    if value { Task { await LocationSampler.shared.captureIfDue() } }
                }
            )) {
                Label("Location tracking", systemImage: "location.fill")
                    .font(.system(size: 14))
            }
        }
    }

    private var headerSubtitle: String {
        guard let heatmap, hasData else { return "Fuel notes where you are when you open the app, then shows the pattern here." }
        return "Built from \(heatmap.totalSamples) check-ins across \(heatmap.daysCovered) day\(heatmap.daysCovered == 1 ? "" : "s")."
    }

    private var timelinePanel: some View {
        Panel(title: "Today's pattern", subtitle: "24-hour view, midnight at the top") {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .trailing, spacing: 0) {
                    ForEach([0, 3, 6, 9, 12, 15, 18, 21], id: \.self) { hour in
                        Text(clockLabel(hour * 60))
                            .font(.system(size: 9)).foregroundStyle(Palette.muted(scheme))
                            .frame(maxHeight: .infinity, alignment: .top)
                    }
                }
                .frame(width: 34, height: 300)

                RoundedRectangle(cornerRadius: 6)
                    .fill(LinearGradient(stops: gradientStops, startPoint: .top, endPoint: .bottom))
                    .frame(width: 24, height: 300)

                VStack(alignment: .leading, spacing: 10) {
                    ForEach(Array(spans.enumerated()), id: \.offset) { _, span in
                        HStack(alignment: .top, spacing: 6) {
                            Circle().fill(colorFor(span.placeId)).frame(width: 8, height: 8).padding(.top, 3)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(labelFor(span.placeId)).font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.ink(scheme))
                                Text("\(clockLabel(span.startMinute)) – \(clockLabel(span.endMinute))")
                                    .font(.system(size: 10)).foregroundStyle(Palette.muted(scheme))
                            }
                        }
                    }
                    if spans.isEmpty {
                        Text("Not enough consistent check-ins yet to draw a pattern.")
                            .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }

    private var legendPanel: some View {
        Panel(title: "Your places") {
            ForEach(Array(places.enumerated()), id: \.element.id) { index, place in
                if place.samples > 0 {
                    HStack(spacing: 10) {
                        Circle().fill(index < placeColorOrder.count ? placeColor(at: index) : placeOtherColor)
                            .frame(width: 10, height: 10)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(nameFor(place, index)).font(.system(size: 14, weight: .medium)).foregroundStyle(Palette.ink(scheme))
                            if let detail = place.suggestedDetail, place.label == nil {
                                Text(detail).font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                            }
                        }
                        Spacer()
                        if place.likelyHome, place.label == nil {
                            Text("likely home").font(.system(size: 10))
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Palette.surface(scheme), in: Capsule())
                                .foregroundStyle(Palette.muted(scheme))
                        }
                        Text("\(place.samples) check-in\(place.samples == 1 ? "" : "s")")
                            .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                        Button("Rename") { editingPlace = place }
                            .font(.system(size: 12)).buttonStyle(.bordered).controlSize(.mini)
                    }
                    .padding(.vertical, 4)
                }
            }
            Text("Names come from OpenStreetMap and are only a starting point — rename any place to whatever you actually call it.")
                .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
        }
    }

    private var privacyPanel: some View {
        Panel(title: "Location data") {
            Text("Your fixes are stored in your own Fuel database and are only ever read back to you. To name a place, its averaged centre — never an individual fix, and nothing identifying you — is sent once to OpenStreetMap and the answer is cached. Turning tracking off stops new fixes immediately.")
                .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
            Button(role: .destructive) { showDeleteConfirm = true } label: {
                Label("Delete all location history", systemImage: "trash")
            }
            .disabled(busy)
        }
    }

    // MARK: - Naming and color helpers, matching the website's own precedence

    private func nameFor(_ place: Place?, _ index: Int) -> String {
        place?.label ?? place?.suggestedLabel ?? "Place \(index + 1)"
    }

    private func labelFor(_ id: String?) -> String {
        guard let id, let index = places.firstIndex(where: { $0.id == id }) else { return "No data" }
        return nameFor(places[index], index)
    }

    private func colorFor(_ id: String?) -> Color {
        guard let id, let index = places.firstIndex(where: { $0.id == id }) else { return placeNoData }
        return index < placeColorOrder.count ? placeColor(at: index) : placeOtherColor
    }

    // MARK: - Gradient bar and collapsed spans, from the 48 half-hour buckets

    private var gradientStops: [Gradient.Stop] {
        guard let buckets = heatmap?.buckets, !buckets.isEmpty else {
            return [Gradient.Stop(color: placeNoData, location: 0), Gradient.Stop(color: placeNoData, location: 1)]
        }
        return buckets.map { bucket in
            let position = (Double(bucket.index) + 0.5) / Double(buckets.count)
            let color = bucket.samples > 0 ? blend(colorFor(bucket.placeId), toward: placeNoData, weight: bucket.share) : placeNoData
            return Gradient.Stop(color: color, location: min(1, max(0, position)))
        }
    }

    private struct Span { var placeId: String?; var startMinute: Int; var endMinute: Int; var slots: Int }

    private var spans: [Span] {
        guard let buckets = heatmap?.buckets, !buckets.isEmpty else { return [] }
        let minutesPerBucket = 1440 / buckets.count
        var out: [Span] = []
        for bucket in buckets {
            let id = bucket.samples > 0 ? bucket.placeId : nil
            if let last = out.last, last.placeId == id {
                out[out.count - 1].endMinute = bucket.startMinute + minutesPerBucket
                out[out.count - 1].slots += 1
            } else {
                out.append(Span(placeId: id, startMinute: bucket.startMinute, endMinute: bucket.startMinute + minutesPerBucket, slots: 1))
            }
        }
        // Single half-hour blips are noise, not a place worth showing.
        return out.filter { $0.placeId != nil && $0.slots >= 2 }
    }

    private func blend(_ color: Color, toward base: Color, weight: Double) -> Color {
        let w = max(0.25, min(1, weight))
        let c = UIColor(color).cgColor.components ?? [0, 0, 0, 1]
        let b = UIColor(base).cgColor.components ?? [0, 0, 0, 1]
        func mix(_ i: Int) -> Double { Double(c[min(i, c.count - 1)]) * w + Double(b[min(i, b.count - 1)]) * (1 - w) }
        return Color(red: mix(0), green: mix(1), blue: mix(2))
    }
}

private struct RenamePlaceSheet: View {
    @Environment(AppStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    let place: Place
    let index: Int
    @State private var draft: String
    @State private var saving = false

    init(place: Place, index: Int) {
        self.place = place
        self.index = index
        _draft = State(initialValue: place.label ?? place.suggestedLabel ?? "")
    }

    private var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: place.latitude, longitude: place.longitude)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Map(initialPosition: .region(MKCoordinateRegion(center: coordinate, latitudinalMeters: 350, longitudinalMeters: 350))) {
                        Marker(place.label ?? place.suggestedLabel ?? "Place \(index + 1)", coordinate: coordinate)
                    }
                    .frame(height: 180)
                    .allowsHitTesting(false)
                    .listRowInsets(EdgeInsets())
                } footer: {
                    Text("Map data © OpenStreetMap contributors, via Apple Maps.")
                }
                Section {
                    TextField("Place \(index + 1)", text: $draft)
                    if let suggested = place.suggestedLabel, !suggested.isEmpty,
                       suggested != draft.trimmingCharacters(in: .whitespaces) {
                        Button("Use “\(suggested)”") { draft = suggested }
                    }
                } footer: {
                    Text("Clearing the box puts the map's own name back.")
                }
            }
            .navigationTitle("Rename")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { saving = true; await store.renamePlace(place.id, label: draft); saving = false; dismiss() }
                    }
                    .disabled(saving)
                }
            }
        }
    }
}
