import SwiftUI
import Charts

// The long form of the banner on Today. The banner has room for one line per vital and
// a z-score; this shows each vital against its own history, which is the thing the
// z-score is a summary of. Seeing 44 sitting on a flat 44 baseline is what makes "Low ↓"
// obviously wrong — a number alone never would.

struct VitalsDetailView: View {
    @Environment(\.colorScheme) private var scheme
    @Environment(\.dismiss) private var dismiss
    let trends: [DaySummary]
    let summary: DaySummary?

    private var signal: VitalsSignalResult { computeVitalsSignal(trends: trends, summary: summary) }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                scorePanel(signal)
                ForEach(signal.items, id: \.key) { item in
                    VitalTrendPanel(item: item, trends: trends, today: summary?.date)
                }
                Text("Each chart is your own history for that vital. The band is your usual range — the median plus or minus the spread the score is measured against. A day outside the band is unusual for you; a day inside it is not, however far from the median it looks. Informational only — not a medical diagnosis.")
                    .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
            }
            .padding(16)
        }
        .background(Palette.background(scheme))
        .navigationTitle("Vitals")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func scorePanel(_ s: VitalsSignalResult) -> some View {
        Panel {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 1) {
                    Text("\(s.score ?? 0)").font(.system(size: 34, weight: .bold))
                    Text("/10").font(.system(size: 14)).opacity(0.6)
                }
                .foregroundStyle(tone(s.status))
                VStack(alignment: .leading, spacing: 2) {
                    Text(s.status == .flag ? "Unusual for you today"
                         : s.status == .watch ? "One vital is drifting"
                         : "In line with your baseline")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Palette.ink(scheme))
                    Text("\(s.evaluated) vital\(s.evaluated == 1 ? "" : "s") compared against your history")
                        .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                }
                Spacer()
            }
        }
    }

    private func tone(_ status: VitalsStatus) -> Color {
        switch status { case .flag: return .red; case .watch: return .orange; default: return .green }
    }
}

/// One vital: today's number, its baseline, and the history the comparison is made
/// against, with the usual-range band drawn behind the line.
struct VitalTrendPanel: View {
    @Environment(\.colorScheme) private var scheme
    let item: VitalItem
    let trends: [DaySummary]
    let today: String?

    private var theme: DashboardTheme { DashboardTheme.shared }

    private var points: [(date: String, value: Double)] {
        trends.compactMap { day in item.key.value(day).map { (day.date, $0) } }
    }

    /// The band the score actually uses: median ± the same sigma the z-score divides by,
    /// floored at the vital's minimum meaningful spread. Drawing it makes the floor
    /// visible instead of implicit.
    private var band: (low: Double, high: Double)? {
        guard let center = item.center, let z = item.z, z != 0 else {
            return item.center.map { ($0 - item.key.minimumMeaningfulSpread, $0 + item.key.minimumMeaningfulSpread) }
        }
        let sigma = abs((item.today - center) / z)
        return (center - 2 * sigma, center + 2 * sigma)
    }

    var body: some View {
        Panel(title: item.key.label) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(Format.number(item.today, decimals: item.key.decimals))
                    .font(.system(size: 24, weight: .bold)).foregroundStyle(Palette.ink(scheme))
                Text(item.key.unit).font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                Spacer()
                if item.insufficient {
                    Text("Not enough history yet").font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                } else {
                    VStack(alignment: .trailing, spacing: 1) {
                        Text("usually ~\(Format.number(item.center, decimals: item.key.decimals))")
                            .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                        Text(item.flagged || item.watch
                             ? "\(item.direction == "up" ? "High ↑" : "Low ↓") · z \(Format.number(item.z.map(abs), decimals: 1))"
                             : "Typical · z \(Format.number(item.z.map(abs), decimals: 1))")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(item.flagged ? .red : item.watch ? .orange : Palette.muted(scheme))
                    }
                }
            }

            if points.count > 1 {
                Chart {
                    if let band {
                        RectangleMark(
                            xStart: .value("From", points.first!.date),
                            xEnd: .value("To", points.last!.date),
                            yStart: .value("Low", band.low),
                            yEnd: .value("High", band.high)
                        )
                        .foregroundStyle(theme.accent.opacity(0.10))
                    }
                    if let center = item.center {
                        RuleMark(y: .value("Usual", center))
                            .lineStyle(StrokeStyle(lineWidth: 1, dash: [4, 3]))
                            .foregroundStyle(Palette.muted(scheme).opacity(0.6))
                    }
                    ForEach(points, id: \.date) { point in
                        LineMark(x: .value("Day", point.date), y: .value(item.key.label, point.value))
                            .foregroundStyle(theme.accent)
                            .interpolationMethod(.monotone)
                        if point.date == today {
                            PointMark(x: .value("Day", point.date), y: .value(item.key.label, point.value))
                                .foregroundStyle(item.flagged ? .red : item.watch ? .orange : theme.accent)
                                .symbolSize(70)
                        }
                    }
                }
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 4)) { value in
                        AxisValueLabel {
                            if let raw = value.as(String.self) {
                                Text(DateAxis.short(raw)).font(.system(size: 9))
                            }
                        }
                    }
                }
                .chartYAxis {
                    AxisMarks(values: .automatic(desiredCount: 4)) { value in
                        AxisGridLine().foregroundStyle(Palette.muted(scheme).opacity(0.15))
                        AxisValueLabel {
                            if let v = value.as(Double.self) {
                                Text(Format.number(v, decimals: item.key.decimals)).font(.system(size: 9))
                            }
                        }
                    }
                }
                .frame(height: 130)
            }
        }
    }
}
