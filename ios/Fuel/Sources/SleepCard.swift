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

    private func stageLegend(_ night: SleepNight) -> some View {
        let stages = Self.stages(night)
        return HStack(spacing: 14) {
            ForEach(stages, id: \.name) { stage in
                HStack(spacing: 5) {
                    Circle().fill(stage.color).frame(width: 7, height: 7)
                    Text(stage.name).font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                    Text(SleepNight.duration(stage.minutes) ?? "")
                        .font(.system(size: 11, weight: .medium)).foregroundStyle(Palette.ink(scheme))
                }
            }
            Spacer()
        }
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
