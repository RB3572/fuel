import SwiftUI

// Every mile you have covered since Fuel started watching, next to distances that mean
// something. Pick the ways you moved; the totals, the ring and the comparisons all
// follow the selection.

struct JourneysView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme
    @State private var selected: Set<JourneyMode> = Set(JourneyMode.allCases)

    private var totals: JourneyTotals? { store.journeyTotals }

    private func miles(_ mode: JourneyMode) -> Double {
        guard let totals else { return 0 }
        switch mode {
        case .walkRun: return totals.walkRunMiles
        case .cycling: return totals.cyclingMiles
        case .swimming: return totals.swimmingMiles
        }
    }

    private var selectedMiles: Double { selected.reduce(0) { $0 + miles($1) } }
    private var laps: Double { selectedMiles / Journeys.earthCircumferenceMiles }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 14) {
                if store.journeysLoading && totals == nil {
                    ProgressView().padding(40)
                } else if let totals, totals.hasAnyDistance {
                    modePicker
                    globeCard
                    comparisons
                    footnote(totals)
                } else {
                    Panel(title: "Nothing to plot yet") {
                        Text("Once Fuel has synced a few days of walking, cycling or swimming, this is where the distance adds up.")
                            .font(.footnote).foregroundStyle(Palette.muted(scheme))
                    }
                }
            }
            .padding(16)
        }
        .background(Palette.background(scheme))
        .navigationTitle("Journeys")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.loadJourneyTotals() }
        .refreshable { await store.loadJourneyTotals() }
    }

    // MARK: - Picking how you moved

    private var modePicker: some View {
        Panel {
            VStack(spacing: 8) {
                ForEach(JourneyMode.allCases) { mode in
                    Button {
                        withAnimation(.easeInOut(duration: 0.22)) {
                            // Never all-off: an empty selection has nothing to show, so
                            // the last one standing stays on rather than blanking the screen.
                            if selected.contains(mode) {
                                if selected.count > 1 { selected.remove(mode) }
                            } else {
                                selected.insert(mode)
                            }
                        }
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: selected.contains(mode) ? "checkmark.circle.fill" : "circle")
                                .foregroundStyle(selected.contains(mode) ? DashboardTheme.shared.accent : Palette.muted(scheme))
                            Image(systemName: mode.icon)
                                .font(.system(size: 13))
                                .foregroundStyle(Palette.muted(scheme))
                                .frame(width: 18)
                            Text(mode.rawValue).font(.system(size: 15)).foregroundStyle(Palette.ink(scheme))
                            Spacer()
                            Text(Format.number(miles(mode)) + " mi")
                                .font(.system(size: 14, weight: .medium, design: .rounded))
                                .foregroundStyle(selected.contains(mode) ? Palette.ink(scheme) : Palette.muted(scheme))
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - The ring

    private var globeCard: some View {
        Panel {
            VStack(spacing: 14) {
                GlobeView(fraction: laps, miles: selectedMiles)
                Text(lapSentence)
                    .font(.system(size: 13))
                    .foregroundStyle(Palette.muted(scheme))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }
        }
    }

    private var lapSentence: String {
        let total = Format.number(Journeys.earthCircumferenceMiles)
        if laps >= 1 {
            let times = laps == 1 ? "once" : String(format: "%.2f times", laps)
            return "That is \(times) around the equator — \(total) miles a lap."
        }
        let remaining = Journeys.earthCircumferenceMiles - selectedMiles
        return "\(Format.number(remaining)) miles to go for a full lap of the equator, which is \(total) miles around."
    }

    // MARK: - What that distance is

    @ViewBuilder
    private var comparisons: some View {
        let found = Journeys.relevant(miles: selectedMiles, modes: selected)
        if let next = found.next {
            Panel(title: "Next up") {
                JourneyProgressRow(journey: next, miles: selectedMiles)
            }
        }
        if !found.completed.isEmpty {
            Panel(title: "Distances you have already covered") {
                VStack(spacing: 0) {
                    ForEach(Array(found.completed.enumerated()), id: \.element.id) { index, journey in
                        JourneyDoneRow(journey: journey, miles: selectedMiles)
                        if index < found.completed.count - 1 {
                            Divider().opacity(0.4).padding(.vertical, 9)
                        }
                    }
                }
            }
        }
    }

    private func footnote(_ totals: JourneyTotals) -> some View {
        Panel {
            VStack(alignment: .leading, spacing: 6) {
                if let since = totals.firstDay, let date = BloodFormat.parse(since) {
                    Text("Counted across \(totals.days) days of synced history, starting \(date.formatted(.dateTime.month(.wide).year())).")
                }
                Text("Walking and running arrive from Apple Health as one daily distance, so they are counted together rather than split on a guess.")
            }
            .font(.system(size: 12))
            .foregroundStyle(Palette.muted(scheme))
        }
    }
}

/// A journey still ahead: how far along it you are.
struct JourneyProgressRow: View {
    @Environment(\.colorScheme) private var scheme
    let journey: Journey
    let miles: Double
    @State private var shown = false

    private var progress: Double { min(1, miles / journey.miles) }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            JourneyArtwork(journey: journey, laps: progress, animate: shown)
                .onScrollVisibilityChange { visible in if visible { shown = true } }
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(journey.name).font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Palette.ink(scheme))
                    Text(journey.detail).font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                }
                Spacer()
                Text("\(Int(progress * 100))%")
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(DashboardTheme.shared.accent)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Palette.surface(scheme))
                    Capsule().fill(DashboardTheme.shared.accent)
                        .frame(width: max(3, geo.size.width * progress))
                }
            }
            .frame(height: 8)
            Text("\(Format.number(journey.miles - miles)) miles to go · \(journey.source)")
                .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
        }
    }
}

/// A journey already covered, and how many times over.
struct JourneyDoneRow: View {
    @Environment(\.colorScheme) private var scheme
    let journey: Journey
    let miles: Double
    @State private var shown = false

    private var times: Double { journey.miles > 0 ? miles / journey.miles : 0 }

    /// "3 times over" reads better than "3.0×", and "1.4 times" better than "1×" when
    /// the extra four tenths is most of another crossing.
    private var timesText: String {
        if times >= 10 { return "\(Int(times.rounded(.down)))× over" }
        if times >= 2 { return String(format: "%.1f× over", times) }
        return "done"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(journey.name).font(.system(size: 14)).foregroundStyle(Palette.ink(scheme))
                    Text("\(journey.detail) · \(Format.number(journey.miles)) mi")
                        .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                }
                Spacer()
                Text(timesText)
                    .font(.system(size: 12, weight: .semibold))
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(Capsule().fill(DashboardTheme.shared.accent.opacity(0.15)))
                    .foregroundStyle(DashboardTheme.shared.accent)
            }
            // Drawn once the row actually comes into view, so the laps trace themselves
            // as you scroll rather than being finished before you arrive.
            JourneyArtwork(journey: journey, laps: times, animate: shown)
                .onScrollVisibilityChange { visible in if visible { shown = true } }
        }
    }
}
