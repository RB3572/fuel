import SwiftUI
import WidgetKit

// Five readings of the same four numbers — burned, consumed, active, resting — because
// which one is "intuitive" depends on what you look for. Rings for a glance, bars for
// the breakdown, a gauge for the single headline, a donut for the split, a stack for
// burned-versus-eaten side by side. Pick one; they all read the same data.

private func balanceLine(_ deficit: Double?) -> (String, String) {
    guard let deficit else { return ("—", "no data yet") }
    return (FuelWidgetFormat.whole(abs(deficit)), deficit >= 0 ? "kcal deficit" : "kcal surplus")
}

private func balanceColor(_ deficit: Double?, _ palette: FuelWidgetPalette) -> Color {
    guard let deficit else { return palette.accent }
    return deficit >= 0 ? palette.deficitColor : palette.surplusColor
}

// MARK: - 1. Rings

struct EnergyRingsView: View {
    var entry: FuelEntry

    private var bands: [RingBand] {
        let s = entry.snapshot
        let p = s.palette
        return [
            .init(progress: (s.consumed ?? 0) / max(1, s.calorieGoal ?? s.burned ?? 1), color: p.accent),
            .init(progress: (s.active ?? 0) / max(1, (s.burned ?? 1) * 0.5), color: p.activeColor),
            .init(progress: (s.resting ?? 0) / max(1, s.burned ?? 1), color: p.restingColor),
        ]
    }

    var body: some View {
        let s = entry.snapshot, p = s.palette
        let (amount, caption) = balanceLine(s.deficit)
        Bubble(palette: p) {
            VStack(spacing: 6) {
                WidgetTitle(text: "Energy", palette: p)
                RingStack(bands: bands, thickness: 7, spacing: 3) {
                    VStack(spacing: -2) {
                        Text(amount).font(.system(size: 19, weight: .bold))
                            .minimumScaleFactor(0.5).lineLimit(1)
                        Text(caption).font(.system(size: 7)).foregroundStyle(.secondary)
                            .lineLimit(1).minimumScaleFactor(0.7)
                    }
                    .frame(width: 58)
                }
                if entry.stale { NotSyncedYet() }
            }
        }
    }
}

// MARK: - 2. Bars

struct EnergyBarsView: View {
    var entry: FuelEntry
    var body: some View {
        let s = entry.snapshot, p = s.palette
        let (amount, caption) = balanceLine(s.deficit)
        let top = max(s.burned ?? 0, s.consumed ?? 0, 1)
        Bubble(palette: p) {
            VStack(alignment: .leading, spacing: 7) {
                WidgetTitle(text: "Energy balance", palette: p,
                            trailing: entry.stale ? "not synced" : nil)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(amount).font(.system(size: 26, weight: .bold))
                        .foregroundStyle(balanceColor(s.deficit, p))
                    Text(caption).font(.system(size: 11)).foregroundStyle(.secondary)
                }
                BarRow(label: "Burned", value: FuelWidgetFormat.whole(s.burned),
                       fraction: (s.burned ?? 0) / top, color: p.accent)
                BarRow(label: "Consumed", value: FuelWidgetFormat.whole(s.consumed),
                       fraction: (s.consumed ?? 0) / top, color: p.surplusColor)
                BarRow(label: "Active", value: FuelWidgetFormat.whole(s.active),
                       fraction: (s.active ?? 0) / top, color: p.activeColor)
                BarRow(label: "Resting", value: FuelWidgetFormat.whole(s.resting),
                       fraction: (s.resting ?? 0) / top, color: p.restingColor)
            }
        }
    }
}

// MARK: - 3. Gauge

struct EnergyGaugeView: View {
    var entry: FuelEntry
    var body: some View {
        let s = entry.snapshot, p = s.palette
        let (amount, caption) = balanceLine(s.deficit)
        Bubble(palette: p) {
            VStack(spacing: 4) {
                WidgetTitle(text: "Balance", palette: p)
                ArcGauge(fraction: abs(s.deficit ?? 0) / max(500, (s.burned ?? 1) * 0.4),
                         color: balanceColor(s.deficit, p)) {
                    VStack(spacing: -2) {
                        Text(amount).font(.system(size: 24, weight: .bold)).minimumScaleFactor(0.5)
                        Text(caption).font(.system(size: 8)).foregroundStyle(.secondary)
                    }
                }
                HStack(spacing: 8) {
                    Text("Burned \(FuelWidgetFormat.whole(s.burned))")
                    Text("Consumed \(FuelWidgetFormat.whole(s.consumed))")
                }
                .font(.system(size: 9)).foregroundStyle(.secondary)
            }
        }
    }
}

// MARK: - 4. Split

struct EnergySplitView: View {
    var entry: FuelEntry
    var body: some View {
        let s = entry.snapshot, p = s.palette
        let burned = max(1, s.burned ?? 1)
        Bubble(palette: p) {
            HStack(spacing: 10) {
                RingStack(bands: [
                    .init(progress: (s.active ?? 0) / burned, color: p.activeColor),
                    .init(progress: (s.resting ?? 0) / burned, color: p.restingColor),
                ], thickness: 11, spacing: 3) {
                    VStack(spacing: -2) {
                        Text(FuelWidgetFormat.whole(s.burned)).font(.system(size: 17, weight: .bold))
                        Text("burned").font(.system(size: 7)).foregroundStyle(.secondary)
                    }
                }
                .frame(width: 78)
                VStack(alignment: .leading, spacing: 5) {
                    WidgetTitle(text: "Burn split", palette: p)
                    KeyDot(color: p.activeColor, label: "Active", value: FuelWidgetFormat.whole(s.active))
                    KeyDot(color: p.restingColor, label: "Resting", value: FuelWidgetFormat.whole(s.resting))
                    KeyDot(color: p.surplusColor, label: "Consumed", value: FuelWidgetFormat.whole(s.consumed))
                }
            }
        }
    }
}

// MARK: - 5. Stack

struct EnergyStackView: View {
    var entry: FuelEntry
    var body: some View {
        let s = entry.snapshot, p = s.palette
        let top = max(s.burned ?? 0, s.consumed ?? 0, 1)
        let (amount, caption) = balanceLine(s.deficit)
        Bubble(palette: p) {
            VStack(alignment: .leading, spacing: 8) {
                WidgetTitle(text: "Burned vs. consumed", palette: p)
                VStack(spacing: 3) {
                    HStack {
                        Text("Burned").font(.system(size: 10)).foregroundStyle(.secondary)
                        Spacer()
                        Text(FuelWidgetFormat.whole(s.burned)).font(.system(size: 11, weight: .semibold))
                    }
                    // One bar, split where active energy ends: the same stack the Today
                    // card draws, so resting is visibly most of the burn.
                    GeometryReader { geo in
                        HStack(spacing: 0) {
                            Rectangle().fill(p.restingColor)
                                .frame(width: geo.size.width * CGFloat((s.resting ?? 0) / top))
                            Rectangle().fill(p.activeColor)
                                .frame(width: geo.size.width * CGFloat((s.active ?? 0) / top))
                            Spacer(minLength: 0)
                        }
                        .background(p.accent.opacity(0.12))
                        .clipShape(RoundedRectangle(cornerRadius: BalanceStrip.barRadius))
                    }
                    .frame(height: 12)
                }
                VStack(spacing: 3) {
                    HStack {
                        Text("Consumed").font(.system(size: 10)).foregroundStyle(.secondary)
                        Spacer()
                        Text(FuelWidgetFormat.whole(s.consumed)).font(.system(size: 11, weight: .semibold))
                    }
                    CapsuleBar(fraction: (s.consumed ?? 0) / top, color: p.surplusColor, height: 12)
                }
                HStack(spacing: 4) {
                    Text(amount).font(.system(size: 15, weight: .bold))
                        .foregroundStyle(balanceColor(s.deficit, p))
                    Text(caption).font(.system(size: 10)).foregroundStyle(.secondary)
                }
            }
        }
    }
}
