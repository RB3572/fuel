import SwiftUI
import Charts

// The night, rather than a single number for it.
//
// This replaces the old Recovery card, which showed sleep hours and a line of the same
// figure over time. Hours alone says almost nothing: eight hours broken into six pieces
// is not eight hours, and the same duration made mostly of deep sleep is not the same
// night as one made mostly of light. So the stages get the space here — how the night was
// built, when it started and ended, and how much of the time in bed was actually spent
// asleep — with the duration trend kept underneath.
//
// Deliberately not a per-minute trace. Apple already draws that; what is useful at a
// glance is the shape of the night and a handful of totals.

struct SleepCard: View {
    @Environment(\.colorScheme) private var scheme
    let summary: DaySummary
    let trend: [(date: String, value: Double)]

    private var night: SleepNight? { SleepNight(summary) }

    var body: some View {
        Panel(title: "Sleep") {
            if let night {
                headline(night)
                if night.hasStages {
                    stageBar(night)
                    stageLegend(night)
                }
                details(night)
                if night.spans.count > 1 {
                    Divider().padding(.top, 2)
                    hypnogram(night)
                }
            } else {
                Text("No sleep recorded for this night.")
                    .font(.footnote).foregroundStyle(Palette.muted(scheme))
            }
            if trend.count > 1 {
                Divider().padding(.top, 2)
                TrendLineChart(title: "Sleep duration", unit: "h", decimals: 1, points: trend)
            }
        }
    }

    private func headline(_ night: SleepNight) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(SleepNight.duration((night.hours ?? 0) * 60) ?? "—")
                .font(.system(size: 30, weight: .bold, design: .rounded))
                .foregroundStyle(Palette.ink(scheme))
            if let start = SleepNight.clock(night.startMinutes), let end = SleepNight.clock(night.endMinutes) {
                Text("\(start) → \(end)")
                    .font(.system(size: 13)).foregroundStyle(Palette.muted(scheme))
            }
            Spacer()
        }
    }

    /// The night as one bar, in the order the stages are usually drawn: deep at the
    /// bottom of the scale, awake at the top.
    private func stageBar(_ night: SleepNight) -> some View {
        let stages = Self.stages(night)
        let total = max(1, stages.reduce(0) { $0 + $1.minutes })
        return GeometryReader { geo in
            HStack(spacing: 1.5) {
                ForEach(stages, id: \.name) { stage in
                    RoundedRectangle(cornerRadius: 3)
                        .fill(stage.color)
                        .frame(width: max(2, geo.size.width * stage.minutes / total))
                }
            }
        }
        .frame(height: 22)
        .padding(.top, 2)
        .accessibilityLabel("Sleep stages")
        .accessibilityValue(stages.map { "\($0.name) \(Int($0.minutes)) minutes" }.joined(separator: ", "))
    }

    /// One entry per stage, each on a single line. A plain HStack tried to fit five of
    /// them across a phone and broke "Awake" over two lines; a grid that packs as many as
    /// fit and wraps the rest keeps every entry whole however many stages the night had.
    private func stageLegend(_ night: SleepNight) -> some View {
        let stages = Self.stages(night)
        return ViewThatFits(in: .horizontal) {
            row(stages, size: 11, spacing: 10, tight: false)
            // A tighter pass before giving up on one line — four stages at eleven point
            // are a few points too wide for a phone, and shaving the size and the space
            // inside "1h 29m" is a better trade than wrapping.
            row(stages, size: 10, spacing: 7, tight: true)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 84), spacing: 10, alignment: .leading)],
                      alignment: .leading, spacing: 6) {
                ForEach(stages, id: \.name) { stage in
                    HStack(spacing: 0) { entry(stage, size: 11, tight: false); Spacer(minLength: 0) }
                }
            }
        }
    }

    private func row(_ stages: [Stage], size: CGFloat, spacing: CGFloat, tight: Bool) -> some View {
        HStack(spacing: spacing) {
            ForEach(stages, id: \.name) { entry($0, size: size, tight: tight) }
            Spacer(minLength: 0)
        }
    }

    private func entry(_ stage: Stage, size: CGFloat, tight: Bool) -> some View {
        let length = SleepNight.duration(stage.minutes) ?? ""
        return HStack(spacing: tight ? 3 : 4) {
            Circle().fill(stage.color).frame(width: 7, height: 7)
            Text(stage.name).font(.system(size: size)).foregroundStyle(Palette.muted(scheme))
            Text(tight ? length.replacingOccurrences(of: " ", with: "") : length)
                .font(.system(size: size, weight: .medium)).foregroundStyle(Palette.ink(scheme))
        }
        .lineLimit(1)
        .fixedSize()
    }

    /// The night as it actually ran: one lane per stage, awake at the top and deep at the
    /// bottom, which is the order a hypnogram is always drawn in and the order the stages
    /// descend in. The stage bar above says how much of each; this says when.
    private func hypnogram(_ night: SleepNight) -> some View {
        // Row numbers, not the stage's own depth: a night with no unrecognised sleep in
        // it has no "Asleep" lane, and plotting against depth left the hole where that
        // lane would have been as a gap between Core and Deep.
        let lanes = Self.lanes(night)
        let rows = Dictionary(uniqueKeysWithValues:
            lanes.enumerated().map { ($0.element, Double(lanes.count - 1 - $0.offset)) })
        let top = Double(lanes.count - 1)

        return VStack(alignment: .leading, spacing: 8) {
            Text("Through the night")
                .font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.ink(scheme))

            // Plotted against a number rather than the stage's name as a category, so
            // which lane ends up on top is decided here and not by how Charts happens to
            // order a categorical domain.
            Chart(night.spans) { span in
                RectangleMark(
                    xStart: .value("From", span.start),
                    xEnd: .value("To", span.end),
                    y: .value("Stage", rows[span.stage] ?? 0),
                    height: .fixed(16)
                )
                .foregroundStyle(span.stage.color)
                .cornerRadius(3)
            }
            // Pinned to the night rather than left to Charts, which rounds the domain out
            // to midnight and spends the first third of the card on hours spent awake.
            .chartXScale(domain: (night.spans.map(\.start).min() ?? 0)...(night.spans.map(\.end).max() ?? 1))
            .chartYScale(domain: -0.6...(top + 0.6))
            .chartYAxis {
                AxisMarks(position: .leading, values: Array(stride(from: 0.0, through: top, by: 1))) { value in
                    AxisValueLabel {
                        Text(lanes.first { rows[$0] == value.as(Double.self) }?.label ?? "")
                            .font(.system(size: 10)).foregroundStyle(Palette.muted(scheme))
                    }
                }
            }
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 4)) { value in
                    AxisGridLine().foregroundStyle(Palette.border(scheme).opacity(0.5))
                    AxisValueLabel {
                        Text(SleepNight.clock(value.as(Double.self)) ?? "")
                            .font(.system(size: 10)).foregroundStyle(Palette.muted(scheme))
                    }
                }
            }
            .frame(height: CGFloat(lanes.count) * 26 + 24)
            .accessibilityLabel("Sleep stages through the night")

            Text(Self.remNote(night))
                .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 6)
    }

    private func details(_ night: SleepNight) -> some View {
        // Only what this night actually has: a phone without stage tracking should not
        // get a row of dashes.
        let rows: [(String, String)] = [
            night.efficiency.map { ("Efficiency", Format.number($0, decimals: 0) + "%") },
            SleepNight.duration(night.inBedMinutes).map { ("Time in bed", $0) },
            SleepNight.duration(night.latencyMinutes).map { ("Fell asleep in", $0) },
            night.awakenings.map { ("Times woken", Format.number($0, decimals: 0)) },
            SleepNight.duration(night.awakeMinutes).map { ("Awake in the night", $0) },
        ].compactMap { $0 }

        return VStack(spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                HStack {
                    Text(row.0).font(.system(size: 13)).foregroundStyle(Palette.muted(scheme))
                    Spacer()
                    Text(row.1).font(.system(size: 14, weight: .medium)).foregroundStyle(Palette.ink(scheme))
                }
                .padding(.vertical, 5)
                if index < rows.count - 1 { Divider().opacity(0.35) }
            }
        }
        .padding(.top, 4)
    }

    /// The stages this night actually had, deepest last so the chart reads awake at the
    /// top down to deep at the bottom.
    private static func lanes(_ night: SleepNight) -> [SleepSpan.Stage] {
        let present = Set(night.spans.map(\.stage))
        return SleepSpan.Stage.allCases.filter { present.contains($0) }.sorted { $0.depth > $1.depth }
    }

    /// What the shape of the night means, with this night's number in front of it.
    private static func remNote(_ night: SleepNight) -> String {
        let rem = night.spans.filter { $0.stage == .rem }
        let total = rem.reduce(0) { $0 + $1.minutes }
        guard let first = night.spans.map(\.start).min(),
              let last = night.spans.map(\.end).max(),
              last > first, total > 0
        else { return explanation }

        let midpoint = (first + last) / 2
        let late = rem.reduce(0) { $0 + max(0, $1.end - max($1.start, midpoint)) }
        let share = Int((late / total * 100).rounded())
        let lead = share >= 55
            ? "\(share)% of your REM came in the second half of the night, which is the usual shape."
            : "\(share)% of your REM came in the second half of the night — less back-loaded than a typical night."
        return lead + " " + explanation
    }

    private static let explanation = """
    Deep sleep — N3 — front-loads into the first couple of hours, and REM stretches longer \
    with every cycle, so the last hour before waking normally carries the most of it. Core \
    is N1 and N2 together, which Apple reports as one stage. That ordering is why a night \
    cut short at the end loses REM first, and why an unusually large REM share often \
    follows a stretch of short or broken nights — the brain takes back what it missed. \
    Alcohol does it in reverse: it suppresses REM early and lets it rebound before morning.
    """

    private struct Stage { var name: String; var minutes: Double; var color: Color }

    private static func stages(_ night: SleepNight) -> [Stage] {
        [
            Stage(name: "Deep", minutes: night.deepMinutes ?? 0, color: Color(hex: 0x3B4CC0)),
            Stage(name: "Core", minutes: night.coreMinutes ?? 0, color: Color(hex: 0x5B8DEF)),
            Stage(name: "REM", minutes: night.remMinutes ?? 0, color: Color(hex: 0x8ED1E6)),
            Stage(name: "Asleep", minutes: night.unspecifiedMinutes ?? 0, color: Color(hex: 0x9AA7C7)),
            Stage(name: "Awake", minutes: night.awakeMinutes ?? 0, color: Color(hex: 0xE8A33D)),
        ].filter { $0.minutes > 0 }
    }
}
