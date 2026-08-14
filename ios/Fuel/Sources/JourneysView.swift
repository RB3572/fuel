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

    /// One card per journey — the route where it actually is, nearest goal first, then
    /// everything already covered, longest first.
    @ViewBuilder
    private var comparisons: some View {
        let found = Journeys.relevant(miles: selectedMiles, modes: selected)
        if let next = found.next {
            JourneyMapCard(journey: next, laps: min(1, selectedMiles / next.miles), milesCovered: selectedMiles)
        }
        ForEach(found.completed) { journey in
            JourneyMapCard(journey: journey,
                           laps: journey.miles > 0 ? selectedMiles / journey.miles : 0,
                           milesCovered: selectedMiles)
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
