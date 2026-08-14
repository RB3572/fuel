import SwiftUI
import UIKit
import Charts
import UniformTypeIdentifiers

// The website's dashboard, whole. Same eight sections in the same order, the same six
// energy boxes, the same 39-nutrient grid, the same metric cards — and the same edit
// controls: food entries, goals, past-day energy, and which sections show at all.
//
// The layout is server-backed, so reordering here reorders the website too. That is the
// point of replicating rather than reimagining: one dashboard, two windows onto it.
//
// Customising the layout is a long-press away, not a separate settings sheet: hold any
// card and the whole dashboard jiggles, the way Home Screen icons do. Each card gets a
// hide/show badge and becomes draggable for reordering while jiggling; tapping Done
// saves the result. There is no website equivalent for this interaction (the website
// uses a hide/reorder list) — this is the same underlying layout, edited the way a
// phone actually expects it to be edited.

enum EnergyRangeKey: String, CaseIterable { case day = "Day", week = "Week", month = "Month" }

struct TodayView: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme

    @State private var editingFood: FoodEntry?
    @State private var showGoals = false
    @State private var showHistory = false
    @State private var showColors = false
    @State private var filling = false
    @State private var fillProgress = ""
    @State private var range: EnergyRangeKey = .day

    /// Entries ticked for turning into a saved meal. Non-empty means the food card is in
    /// selection mode; the rest of the dashboard is untouched.
    @State private var selectedEntryIDs: Set<String> = []
    @State private var namingMeal = false
    @State private var newMealName = ""

    @State private var dashboardEditing = false
    @State private var draftLayout = DashboardLayout.default
    @State private var draggingKey: String?

    /// The day-paging slide: follows the finger while dragging, then on release either
    /// snaps back or carries the current day fully off-screen while the new one slides
    /// in from the opposite edge — a real page transition rather than the data simply
    /// changing under a static view.
    @State private var pageDragOffset: CGFloat = 0
    @State private var pageAnimating = false
    @State private var pageWidth: CGFloat = 0
    /// True while a food row is being swiped open, which suppresses day-paging.
    @State private var rowSwiping = false

    private var summary: DaySummary? { store.viewingSummary }

    private func snapBack() {
        withAnimation(.interactiveSpring(response: 0.3, dampingFraction: 0.86)) { pageDragOffset = 0 }
    }

    /// Carries the current day fully off-screen in the direction it was dragged, swaps
    /// the underlying data once it's clear, then slides the new day in from the
    /// opposite edge — the same illusion UIKit's page view controller gives, built from
    /// one view whose content changes under it rather than two views crossfading.
    private func slidePage(goingBack: Bool) {
        // Measured from the view itself rather than read off the screen: the slide has
        // to clear the content's own width, which is what a split view or a resized
        // window changes without the screen's bounds ever moving.
        let width = pageWidth > 0 ? pageWidth : 420
        pageAnimating = true
        withAnimation(.easeIn(duration: 0.16)) {
            pageDragOffset = goingBack ? width : -width
        }
        Task {
            try? await Task.sleep(for: .seconds(0.16))
            store.page(goingBack ? 1 : -1)
            // No animation: parks the new content off-screen on the entry side before
            // the next line animates it in — a silent jump, since it happens off-screen.
            pageDragOffset = goingBack ? -width : width
            withAnimation(.easeOut(duration: 0.24)) { pageDragOffset = 0 }
            pageAnimating = false
        }
    }

    /// "Today", "Yesterday", or "Mon Aug 11" — what the day-paging swipe landed on. The
    /// tab itself is called Dashboard; this title names the day being shown.
    private var pageTitle: String {
        if store.isViewingToday { return "Today" }
        if store.dayOffset == 1 { return "Yesterday" }
        guard let date = store.viewingDate else { return "Today" }
        return NetBalanceTrendChart.label(for: date)
    }
    private var goals: Goals? { store.dashboard?.goals }

    /// The layout being displayed: the live, server-synced one normally, or the local
    /// in-progress draft while jiggling — so every edit previews instantly and nothing
    /// is written until Done.
    private var activeLayout: DashboardLayout { dashboardEditing ? draftLayout : store.layout }
    private var displayedKeys: [String] {
        dashboardEditing ? activeLayout.order : activeLayout.order.filter { !activeLayout.hidden.contains($0) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                ScrollViewReader { scroller in
                // Lazy, so the cards below the fold are not built until they are
                // actually scrolled to. Eagerly, this constructed every section on every
                // render — eight cards, several of them SwiftUI Charts — which is the
                // bulk of the cost of a single frame here, and it was being paid again
                // for every offset change while paging and for every store update.
                LazyVStack(spacing: 14) {
                    if let summary {
                        if !dashboardEditing {
                            VitalsSignalBar(trends: store.dashboard?.trends ?? [], summary: summary)
                        }
                        energyHero(summary)
                        ForEach(displayedKeys, id: \.self) { key in
                            cardWrapper(key) { section(key, summary) }
                                .id(key)
                        }
                        if !dashboardEditing { coveragePanel }
                    } else if store.loading {
                        ProgressView().padding(40)
                    } else {
                        Panel(title: "No data yet") {
                            Text("Pull to refresh once your first sync completes.")
                                .font(.footnote).foregroundStyle(Palette.muted(scheme))
                        }
                    }
                    if let error = store.error {
                        Panel(title: "Something went wrong") {
                            Text(error).font(.footnote).foregroundStyle(.orange)
                        }
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity)
                .background(
                    GeometryReader { geo in
                        Color.clear
                            .onAppear { pageWidth = geo.size.width }
                            .onChange(of: geo.size.width) { _, width in pageWidth = width }
                    }
                )
                .offset(x: pageDragOffset)
                // Tapping anywhere outside the food card exits selection mode. The food
                // card itself absorbs its own taps (see foodSection's contentShape), so
                // this only ever fires for genuinely outside taps — other cards, gaps
                // between them, empty space — never for something happening inside it.
                .contentShape(Rectangle())
                .onTapGesture { if selecting { exitSelection() } }
                // Swipe right to go back a day, further right for the day before that;
                // swipe left to come forward toward today. A high minimumDistance plus
                // requiring the drag to be clearly more horizontal than vertical is the
                // same disambiguation FoodEntryRow's own swipe uses — that is what lets
                // a horizontal gesture live inside a vertical ScrollView at all without
                // fighting it, unlike chartScrollableAxes, which has no such guard and
                // is why the charts had to lose their own drag-to-scroll.
                .simultaneousGesture(
                    DragGesture(minimumDistance: 40)
                        .onChanged { value in
                            guard !selecting, !dashboardEditing, !pageAnimating, !rowSwiping else { return }
                            guard abs(value.translation.width) > abs(value.translation.height) * 1.5 else { return }
                            // Nothing moves at all in a direction with no day behind it.
                            // On today that means the whole "forward" half of the gesture
                            // is inert — there is no tomorrow to page to, and a rubber
                            // band that always snaps back just reads as the page being
                            // loose. Older days can be dragged either way.
                            guard store.canPage(value.translation.width > 0 ? 1 : -1) else { return }
                            pageDragOffset = value.translation.width
                        }
                        .onEnded { value in
                            guard !selecting, !dashboardEditing, !pageAnimating, !rowSwiping,
                                  abs(value.translation.width) > abs(value.translation.height) * 1.5 else {
                                snapBack()
                                return
                            }
                            let goingBack = value.translation.width > 0
                            guard store.canPage(goingBack ? 1 : -1) else {
                                snapBack()
                                return
                            }
                            slidePage(goingBack: goingBack)
                        }
                )
                // A meal logged from the camera lands here: scroll to the row it made
                // and flash it, so the confirmation is the entry itself rather than a
                // banner on a screen that never showed the result.
                .onChange(of: store.highlightedEntryID) { _, id in
                    guard let id else { return }
                    Task {
                        // Two steps, because the stack is lazy: a row inside the food
                        // card does not exist as a scroll target until that card has
                        // been built, so jump to the card first (its key is a direct
                        // child of the lazy stack and always addressable), let it come
                        // into being, then home in on the row itself.
                        withAnimation(.easeInOut(duration: 0.35)) { scroller.scrollTo("foodConsumed", anchor: .top) }
                        try? await Task.sleep(for: .milliseconds(120))
                        withAnimation(.easeInOut(duration: 0.35)) { scroller.scrollTo(id, anchor: .center) }
                        try? await Task.sleep(for: .seconds(2.6))
                        withAnimation(.easeOut(duration: 0.5)) { store.highlightedEntryID = nil }
                    }
                }
                }
            }
            .background(Palette.background(scheme))
            .navigationTitle(pageTitle)
            .toolbar {
                if !store.isViewingToday {
                    // Deliberately a bare title-only Button: no custom label view, no
                    // style, no background of its own. A custom label — even a Text with
                    // padding and a Capsule behind it — is treated as icon-shaped content
                    // and packed into a fixed circular container, which is what kept
                    // clipping the word and leaving it off-centre. A plain titled button
                    // is laid out as a capsule sized to its own text, which is the shape
                    // this wants; .fixedSize() then guarantees it is never squeezed.
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Today") {
                            withAnimation(.easeInOut(duration: 0.22)) { store.resetToToday() }
                        }
                        .fixedSize()
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    if dashboardEditing {
                        Button("Done") { endEditing() }.fontWeight(.semibold)
                    } else {
                        Menu {
                            Button { showGoals = true } label: { Label("Edit goals", systemImage: "target") }
                            Button { showHistory = true; Task { await store.loadHistory() } } label: {
                                Label("Edit past days", systemImage: "calendar")
                            }
                            Button { beginEditing() } label: { Label("Customise dashboard", systemImage: "square.grid.2x2") }
                            Button { showColors = true } label: { Label("Dashboard colors", systemImage: "paintpalette") }
                        } label: { Image(systemName: "ellipsis.circle") }
                    }
                }
            }
            // No load() after this: syncHealth already ends with one, so asking again
            // fetched the whole dashboard twice for every pull.
            .refreshable { await store.syncHealth(reason: "pull to refresh") }
            .sheet(item: $editingFood) { EditFoodSheet(entry: $0) }
            .sheet(isPresented: $showGoals) { GoalsSheet() }
            .sheet(isPresented: $showColors) { DashboardColorsSheet() }
            .sheet(isPresented: $showHistory) { HistorySheet() }
        }
    }

    // MARK: Turning logged entries into a saved meal

    /// True while the user is picking entries. Kept separate from the selection itself so
    /// the checkboxes stay visible after they untick the last one — otherwise clearing a
    /// selection silently drops you out of selection mode.
    @State private var selecting = false

    /// Idle: a "Select" button. Selecting: nothing chosen yet shows a Cancel and a hint;
    /// the moment something is picked, that same slot becomes Save-as-meal plus a
    /// Delete button — so the bar always shows exactly the actions that make sense for
    /// where you are, instead of a fixed row of buttons some of which are disabled.
    private var saveAsMealBar: some View {
        HStack(spacing: 10) {
            if selecting {
                if selectedEntryIDs.isEmpty {
                    Button("Cancel") { exitSelection() }
                        .font(.system(size: 13))
                    Spacer()
                    Text("Tap entries to select").font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                } else {
                    Button(role: .destructive) {
                        let ids = Array(selectedEntryIDs)
                        exitSelection()
                        Task { await store.deleteFoods(ids) }
                    } label: {
                        Label("Delete", systemImage: "trash").font(.system(size: 13))
                    }
                    Spacer()
                    Text("\(selectedEntryIDs.count) selected")
                        .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                    Button("Save as meal") {
                        newMealName = defaultMealName
                        namingMeal = true
                    }
                    .font(.system(size: 13, weight: .semibold))
                }
            } else {
                Button { selecting = true } label: {
                    Label("Select", systemImage: "checkmark.circle")
                        .font(.system(size: 13))
                }
                Spacer()
            }
        }
        .padding(.bottom, 4)
        .alert("Name this meal", isPresented: $namingMeal) {
            TextField("e.g. usual breakfast", text: $newMealName)
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                let ids = Array(selectedEntryIDs)
                let name = newMealName
                exitSelection()
                Task { await store.saveMeal(named: name, fromEntryIDs: ids) }
            }
        } message: {
            Text("It'll appear at the top of your log library, ready to log again.")
        }
    }

    /// One selected entry names itself; several need a name from the user, so the field
    /// starts empty rather than guessing from whichever entry happened to be first.
    private var defaultMealName: String {
        let entries = store.viewingFoodEntries
        let picked = entries.filter { selectedEntryIDs.contains($0.id) }
        return picked.count == 1 ? (picked[0].food ?? "") : ""
    }

    private func toggleSelection(_ id: String) {
        if selectedEntryIDs.contains(id) { selectedEntryIDs.remove(id) }
        else { selectedEntryIDs.insert(id) }
    }

    private func exitSelection() {
        withAnimation(.easeInOut(duration: 0.2)) {
            selecting = false
            selectedEntryIDs = []
        }
    }

    // MARK: Jiggle-mode dashboard editing

    private func beginEditing() {
        draftLayout = store.layout
        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.impactOccurred()
        withAnimation(.spring(response: 0.3, dampingFraction: 0.65)) { dashboardEditing = true }
    }

    private func endEditing() {
        withAnimation { dashboardEditing = false }
        Task { await store.saveLayout(draftLayout) }
    }

    private func toggleHidden(_ key: String) {
        if draftLayout.hidden.contains(key) { draftLayout.hidden.removeAll { $0 == key } }
        else { draftLayout.hidden.append(key) }
    }

    /// Re-adding a box restores it to its canonical position rather than appending it
    /// at the end, matching the website's own toggleBox reducer.
    private func toggleEnergyBox(_ key: String) {
        if draftLayout.energyBoxes.contains(key) { draftLayout.energyBoxes.removeAll { $0 == key } }
        else { draftLayout.energyBoxes = DashboardLayout.allEnergyBoxes.filter { $0 == key || draftLayout.energyBoxes.contains($0) } }
    }

    /// Wraps one section's card with the jiggle animation, its hide/show badge, and
    /// drag-to-reorder — only active while dashboardEditing.
    @ViewBuilder
    private func cardWrapper<Content: View>(_ key: String, @ViewBuilder content: () -> Content) -> some View {
        let hidden = activeLayout.hidden.contains(key)
        let card = content()
            .opacity(dashboardEditing && hidden ? 0.4 : 1)
            .jiggling(dashboardEditing, seed: key)
            .overlay(alignment: .topLeading) {
                if dashboardEditing {
                    Button { toggleHidden(key) } label: {
                        Image(systemName: hidden ? "plus.circle.fill" : "minus.circle.fill")
                            .font(.system(size: 24))
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(.white, hidden ? .green : .red)
                    }
                    .offset(x: -8, y: -8)
                    .transition(.scale.combined(with: .opacity))
                }
            }
        // Drag-to-reorder only engages once already jiggling — outside edit mode a
        // long press is what starts it, exactly like the Home Screen.
        if dashboardEditing {
            card
                .onDrag {
                    draggingKey = key
                    return NSItemProvider(object: key as NSString)
                }
                .onDrop(of: [.text], delegate: SectionDropDelegate(item: key, layout: $draftLayout, draggingItem: $draggingKey))
        } else {
            card.onLongPressGesture(minimumDuration: 0.4) { beginEditing() }
        }
    }

    // MARK: Energy hero — headline, range tabs, the six boxes, and the two trend charts

    private var rangeDays: Int {
        switch range { case .day: return 1; case .week: return 7; case .month: return 30 }
    }
    private var rangeVisible: [DaySummary] { Array((store.dashboard?.trends ?? []).suffix(rangeDays)) }
    private var rangeBalance: Double? {
        let consumed = rangeVisible.reduce(0.0) { $0 + ($1.caloriesConsumed ?? 0) }
        let expended = rangeVisible.reduce(0.0) { $0 + ($1.totalExpenditure ?? 0) }
        return (consumed > 0 && expended > 0) ? consumed - expended : nil
    }

    @ViewBuilder
    private func energyHero(_ s: DaySummary) -> some View {
        Panel {
            VStack(alignment: .leading, spacing: 3) {
                Text("ENERGY BALANCE").font(.system(size: 11, weight: .semibold)).kerning(0.6)
                    .foregroundStyle(Palette.muted(scheme))
                Text(rangeBalance == nil ? "Incomplete data"
                     : rangeBalance! > 0 ? "\(Format.number(rangeBalance)) kcal surplus" : "\(Format.number(abs(rangeBalance!))) kcal deficit")
                    .font(.system(size: 26, weight: .bold, design: .rounded)).foregroundStyle(Palette.ink(scheme))
                Text("\(range == .day ? "Today" : range == .week ? "Last 7 days" : "Last 30 days") · intake versus total expenditure")
                    .font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
            }
            Picker("Range", selection: $range) {
                ForEach(EnergyRangeKey.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.top, 2)

            if dashboardEditing {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(DashboardLayout.allEnergyBoxes, id: \.self) { key in energyBoxTile(key, s) }
                }
                .padding(.top, 6)
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(Array(Self.chartLabels.keys.sorted()), id: \.self) { key in chartToggleTile(key) }
                }
                .padding(.top, 8)
            } else {
                EnergySummaryBars(summary: s, rolling24h: store.dashboard?.rolling24h, boxes: activeLayout.energyBoxes)
                    .padding(.top, 10)
            }

            Group {
                if activeLayout.charts.contains("intraday"), let intraday = store.dashboard?.intradayEnergy {
                    intradayChart(intraday)
                }
                if let averages = store.dashboard?.energyAverages {
                    Divider()
                    HStack(alignment: .top, spacing: 8) {
                        Stat(label: "Avg burned", value: Format.kcal(averages.totalExpenditure))
                        Stat(label: "Avg resting", value: Format.kcal(averages.restingEnergy))
                        Stat(label: "Avg active", value: Format.kcal(averages.activeEnergy))
                        // Sign is the point here, so it carries the same two colours as
                        // the bars below rather than the neutral ink the others use.
                        if let balance = averages.energyBalance {
                            Stat(label: balance > 0 ? "Avg surplus" : "Avg deficit",
                                 value: Format.kcal(abs(balance)),
                                 tint: balance > 0 ? DashboardTheme.shared.positive
                                                   : DashboardTheme.shared.negative)
                        }
                    }
                }
                Divider()
                NetBalanceTrendChart(trends: Array((store.dashboard?.trends ?? []).suffix(30)))
            }
        }
    }

    // "components" stays in the layout schema (the server and website still round-trip
    // it) but the grouped-bar chart it controlled is gone, so it is not offered here.
    private static let chartLabels = ["intraday": "Daily intake"]

    /// Same shape as energyBoxTile — a compact chip that's both the preview and the
    /// toggle — but for the two big charts rather than a numeric stat, so there's
    /// nothing to render inline except the label and its on/off badge.
    @ViewBuilder
    private func chartToggleTile(_ key: String) -> some View {
        let hidden = !draftLayout.charts.contains(key)
        HStack(spacing: 6) {
            Image(systemName: "chart.xyaxis.line").font(.system(size: 12))
            Text(Self.chartLabels[key] ?? key).font(.system(size: 13, weight: .medium))
        }
        .foregroundStyle(Palette.ink(scheme))
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(Palette.surface(scheme))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .opacity(hidden ? 0.35 : 1)
        .jiggling(dashboardEditing, seed: key)
        .overlay(alignment: .topTrailing) {
            Button { toggleChart(key) } label: {
                Image(systemName: hidden ? "plus.circle.fill" : "minus.circle.fill")
                    .font(.system(size: 17))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(.white, hidden ? .green : .red)
            }
            .offset(x: 6, y: -6)
        }
    }

    /// Re-adding a chart restores it to its canonical position, matching toggleEnergyBox.
    private func toggleChart(_ key: String) {
        if draftLayout.charts.contains(key) { draftLayout.charts.removeAll { $0 == key } }
        else { draftLayout.charts = DashboardLayout.allCharts.filter { $0 == key || draftLayout.charts.contains($0) } }
    }

    @ViewBuilder
    private func energyBoxTile(_ key: String, _ s: DaySummary) -> some View {
        let hidden = !activeLayout.energyBoxes.contains(key)
        Group {
            switch key {
            case "totalBurned": Stat(label: "Total burned", value: Format.kcal(s.totalExpenditure))
            case "consumed": Stat(label: "Consumed", value: Format.kcal(s.caloriesConsumed))
            case "active": Stat(label: "Active", value: Format.kcal(s.activeEnergy))
            case "resting": Stat(label: "Resting", value: Format.kcal(s.restingEnergy))
            case "deficit":
                let total = s.totalExpenditure ?? ((s.restingEnergy ?? 0) + (s.activeEnergy ?? 0))
                let balance = total - (s.caloriesConsumed ?? 0)
                Stat(label: balance >= 0 ? "Deficit" : "Surplus", value: Format.kcal(abs(balance)),
                     detail: s.partialDay == true ? "settles at midnight" : nil)
            case "rolling24":
                let r = store.dashboard?.rolling24h?.balance
                Stat(label: "24h \(r != nil && r! < 0 ? "deficit" : "surplus")", value: Format.kcal(r.map(abs)))
            default: EmptyView()
            }
        }
        .opacity(dashboardEditing && hidden ? 0.35 : 1)
        .jiggling(dashboardEditing, seed: key)
        .overlay(alignment: .topTrailing) {
            if dashboardEditing {
                Button { toggleEnergyBox(key) } label: {
                    Image(systemName: hidden ? "plus.circle.fill" : "minus.circle.fill")
                        .font(.system(size: 17))
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, hidden ? .green : .red)
                }
                .offset(x: 6, y: -4)
            }
        }
    }

    /// nil (rather than an empty Chart with no marks) when there's genuinely nothing
    /// to plot yet — an empty Chart still draws axes, which reads as "broken", not
    /// "no data".
    @ViewBuilder
    private func intradayChart(_ intraday: IntradayEnergy) -> some View {
        let parser = ISO8601DateFormatter()
        let burn = intraday.expenditure.compactMap { point -> (Date, Double)? in
            guard let at = parser.date(from: point.collectedAt), let value = point.totalExpenditure else { return nil }
            return (at, value)
        }
        let eaten = intraday.consumed.compactMap { point -> (Date, Double)? in
            guard let at = parser.date(from: point.collectedAt), let value = point.caloriesConsumed else { return nil }
            return (at, value)
        }
        if burn.isEmpty && eaten.isEmpty {
            EmptyView()
        } else {
            Chart {
                ForEach(burn, id: \.0) { point in
                    LineMark(x: .value("Time", point.0), y: .value("kcal", point.1))
                        .foregroundStyle(Palette.muted(scheme)).interpolationMethod(.monotone)
                }
                ForEach(eaten, id: \.0) { point in
                    LineMark(x: .value("Time", point.0), y: .value("kcal", point.1))
                        .foregroundStyle(DashboardTheme.shared.consumed).interpolationMethod(.stepEnd)
                }
            }
            .chartLegend(.hidden)
            .frame(height: 120)
        }
    }

    // MARK: The eight sections

    @ViewBuilder
    private func section(_ key: String, _ s: DaySummary) -> some View {
        switch key {
        case "nutrition": nutritionSection(s)
        case "detailedNutrition": nutrientGrid(s)
        case "foodConsumed": foodSection
        case "fitness":
            VStack(spacing: 14) {
                ActivityRingsCard(
                    move: s.activeEnergy ?? 0, moveTarget: goals?.move?.target ?? 1000,
                    exercise: s.exerciseMinutes ?? 0, exerciseTarget: goals?.exercise?.target ?? 80,
                    stand: s.standMinutes ?? 0, standTarget: goals?.stand?.target ?? 120)
                metricSection("Fitness", fitnessMetrics(s))
            }
        case "workouts": workoutsSection
        case "steps":
            Panel(title: "Steps") {
                TrendLineChart(title: "Daily steps", unit: "steps", decimals: 0,
                               points: trendPoints { $0.stepCount })
            }
        case "vitals":
            VStack(spacing: 14) {
                metricSection("Vitals", vitalsMetrics(s))
                vitalsOverTimePanel
            }
        case "recovery":
            Panel(title: "Recovery") {
                Stat(label: "Sleep", value: s.sleepHours == nil ? "—" : "\(Format.number(s.sleepHours, decimals: 1)) h")
                TrendLineChart(title: "Sleep duration", unit: "h", decimals: 1,
                               points: trendPoints { $0.sleepHours })
            }
        default: EmptyView()
        }
    }

    /// Same ordering, and the same "only show if it's ever actually happened" gating,
    /// as the website's positive(...) checks around the optional fitness metrics.
    private func fitnessMetrics(_ s: DaySummary) -> [(String, Double?, String, Int)] {
        var items: [(String, Double?, String, Int)] = [
            ("Active energy", s.activeEnergy, "kcal", 0),
            ("Exercise", s.exerciseMinutes, "min", 0),
            ("Walking + running", s.distanceMiles, "mi", 2),
        ]
        if let v = s.runningStrideLength, v > 0 { items.append(("Running stride length", v, "m", 2)) }
        items.append(("Steps", s.stepCount, "", 0))
        if let v = s.standMinutes, v > 0 { items.append(("Stand time", v, "min", 0)) }
        if let v = s.flightsClimbed, v > 0 { items.append(("Flights climbed", v, "flights", 0)) }
        if let v = s.cyclingDistanceMiles, v > 0 { items.append(("Cycling distance", v, "mi", 2)) }
        return items
    }

    private func vitalsMetrics(_ s: DaySummary) -> [(String, Double?, String, Int)] {
        var items: [(String, Double?, String, Int)] = [
            ("Resting heart rate", s.restingHeartRate, "bpm", 0),
            ("HRV", s.hrv, "ms", 0),
            ("Respiratory rate", s.respiratoryRate, "/min", 1),
            ("VO₂ max", s.vo2Max, "", 1),
        ]
        if let v = s.bloodOxygen, v > 0 { items.append(("Blood oxygen", v, "%", 1)) }
        if let v = s.walkingHeartRateAverage, v > 0 { items.append(("Walking heart rate", v, "bpm avg", 0)) }
        if let v = s.cardioRecovery, v > 0 { items.append(("Cardio recovery", v, "bpm", 1)) }
        return items
    }

    /// One small trend chart per vital that has at least two points to draw a line
    /// through — matching the website's VitalTrends panel below the Vitals grid.
    @ViewBuilder
    private var vitalsOverTimePanel: some View {
        let charts: [(String, String, Int, (DaySummary) -> Double?)] = [
            ("Resting heart rate", "bpm", 0, { $0.restingHeartRate }),
            ("HRV", "ms", 0, { $0.hrv }),
            ("VO₂ max", "mL/kg/min", 1, { $0.vo2Max }),
            ("Walking heart rate", "bpm", 0, { $0.walkingHeartRateAverage }),
            ("Respiratory rate", "/min", 1, { $0.respiratoryRate }),
            ("Blood oxygen", "%", 1, { $0.bloodOxygen }),
            ("Cardio recovery", "bpm", 1, { $0.cardioRecovery }),
        ].filter { trendPoints($0.3).count >= 2 }
        if !charts.isEmpty {
            Panel(title: "Vitals over time") {
                VStack(spacing: 18) {
                    ForEach(charts, id: \.0) { title, unit, decimals, pick in
                        TrendLineChart(title: title, unit: unit, decimals: decimals, points: trendPoints(pick))
                    }
                }
            }
        }
    }

    private func trendPoints(_ pick: (DaySummary) -> Double?) -> [(date: String, value: Double)] {
        (store.dashboard?.trends ?? []).compactMap { day in pick(day).map { (day.date, $0) } }
    }

    private func nutritionSection(_ s: DaySummary) -> some View {
        Panel(title: "Nutrition") {
            HStack(alignment: .top, spacing: 22) {
                VStack(spacing: 8) {
                    CalorieRing(value: s.caloriesConsumed, target: goals?.calories?.target, unit: "kcal")
                    Text("Calculated calories").font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.muted(scheme))
                        .multilineTextAlignment(.center).frame(maxWidth: 148)
                }
                VStack(spacing: 10) {
                    GoalBar(label: "Protein", value: s.protein, target: goals?.protein?.target, unit: " g")
                    GoalBar(label: "Carbohydrates", value: s.carbs, target: goals?.carbs?.target, unit: " g")
                    GoalBar(label: "Fat", value: s.fat, target: goals?.fat?.target, unit: " g")
                    GoalBar(label: "Fiber", value: s.fiber, target: goals?.fiber?.target, unit: " g")
                }
            }
            Divider()
            GoalBar(label: "Move", value: s.activeEnergy, target: goals?.move?.target, unit: " kcal")
            GoalBar(label: "Exercise", value: s.exerciseMinutes, target: goals?.exercise?.target, unit: " min")
            GoalBar(label: "Stand", value: s.standMinutes, target: goals?.stand?.target, unit: " min")
            GoalBar(label: "Steps", value: s.stepCount, target: goals?.steps?.target)
            GoalBar(label: "Sleep", value: s.sleepHours, target: goals?.sleepHours?.target, unit: " h")
        }
    }

    private func nutrientGrid(_ s: DaySummary) -> some View {
        let tracked = Nutrient.display.compactMap { item -> (Nutrient, Double)? in
            guard let value = s.nutrients?[item.key] else { return nil }
            return (item, value)
        }
        return Panel(title: "Detailed nutrition") {
            if tracked.isEmpty {
                Text("Detailed nutrients will appear as newly logged foods include them.")
                    .font(.footnote).foregroundStyle(Palette.muted(scheme))
            } else {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(tracked, id: \.0.key) { item, value in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(item.label).font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                            HStack(spacing: 3) {
                                Text(Format.number(value, decimals: item.decimals))
                                    .font(.system(size: 17, weight: .medium, design: .rounded))
                                Text(item.unit).font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
    }

    private var missing: [FoodEntry] {
        store.viewingFoodEntries.filter { $0.needsNutrition }
    }

    private var foodSection: some View {
        Panel(title: "Food consumed",
              subtitle: store.dayDetailLoading && !store.isViewingToday && store.viewingFoodEntries.isEmpty
                ? "Loading…" : store.viewingFoodEntries.isEmpty ? "Nothing logged yet" : nil) {
            if !store.viewingFoodEntries.isEmpty { saveAsMealBar }
            ForEach(store.viewingFoodEntries) { entry in
                FoodEntryRow(entry: entry, selecting: selecting,
                            selected: selectedEntryIDs.contains(entry.id),
                            highlighted: store.highlightedEntryID == entry.id,
                            onToggleSelect: { toggleSelection(entry.id) },
                            onEdit: { editingFood = entry },
                            rowSwiping: $rowSwiping)
                    .id(entry.id)
                Divider().opacity(0.4)
            }

            // Shown on whatever day is open, because the fill now works on that day.
            // Older days are where blank entries actually accumulate — they are the ones
            // you are no longer around to notice and correct at the time.
            if !missing.isEmpty {
                HStack(spacing: 10) {
                    Text("\(missing.count) \(missing.count == 1 ? "entry is" : "entries are") missing nutrition detail.")
                        .font(.caption).foregroundStyle(Palette.muted(scheme))
                    Spacer()
                    Button {
                        filling = true
                        Task {
                            await store.fillMissingNutrition { done, total in fillProgress = "\(done)/\(total)" }
                            filling = false; fillProgress = ""
                        }
                    } label: {
                        HStack(spacing: 5) {
                            if filling { ProgressView().controlSize(.small) } else { Image(systemName: "sparkles") }
                            Text(filling ? fillProgress : "Fill in with AI").font(.caption)
                        }
                    }
                    .buttonStyle(.bordered).controlSize(.small)
                    .disabled(filling || !OnDeviceAI.shared.isUsable)
                }
            }
        }
        // Claims every tap that lands inside the card — including its title, the
        // select bar, and the gaps between rows — so none of them reach the
        // outside-the-card catcher on the page below and prematurely end selection.
        .contentShape(Rectangle())
        .onTapGesture {}
    }

    private var workoutsSection: some View {
        Panel(title: "Workouts") {
            let workouts = store.viewingWorkouts
            if workouts.isEmpty {
                Text(store.dayDetailLoading && !store.isViewingToday ? "Loading…" : "No workouts recorded.")
                    .font(.footnote).foregroundStyle(Palette.muted(scheme))
            } else {
                ForEach(workouts) { workout in
                    workoutRow(workout)
                }
            }
            let supplements = store.viewingSupplements
            if !supplements.isEmpty {
                Divider()
                ForEach(supplements) { supplement in
                    HStack {
                        Text(supplement.name ?? "—").font(.system(size: 14))
                        Spacer()
                        Text([supplement.time, supplement.dose].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(Palette.muted(scheme))
                    }
                }
            }
        }
    }

    private func workoutRow(_ workout: Workout) -> some View {
        let trailing = [workout.activeCalories.map { "\(Format.kcal($0)) kcal" },
                        workout.durationMinutes.map { "\(Format.number($0)) min" }]
            .compactMap { $0 }.joined(separator: " · ")
        let timeRange = [workout.time, workout.endTime].compactMap { $0 }.joined(separator: "–")
        let detail = [timeRange,
                      workout.swimmingDistanceYards.map { "\(Format.number($0)) yd" },
                      workout.distanceMiles.map { "\(Format.number($0, decimals: 2)) mi" },
                      workout.stepCount.map { "\(Format.number($0)) steps" }]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")

        return HStack(alignment: .top, spacing: 10) {
            ZStack {
                Circle().fill(DashboardTheme.shared.accent.opacity(0.14))
                Image(systemName: workout.icon)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(DashboardTheme.shared.accent)
            }
            .frame(width: 34, height: 34)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline) {
                    Text(workout.activity ?? "Activity").font(.system(size: 15, weight: .medium))
                    Spacer()
                    Text(trailing).font(.system(size: 13, weight: .medium, design: .rounded))
                }
                Text(detail).font(.caption).foregroundStyle(Palette.muted(scheme))
            }
        }
        .padding(.vertical, 4)
    }

    private func metricSection(_ title: String, _ metrics: [(String, Double?, String, Int)]) -> some View {
        Panel(title: title) {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 14) {
                ForEach(metrics, id: \.0) { label, value, unit, decimals in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(label).font(.system(size: 12)).foregroundStyle(Palette.muted(scheme))
                        HStack(spacing: 3) {
                            Text(Format.number(value, decimals: decimals))
                                .font(.system(size: 20, weight: .semibold, design: .rounded))
                            if value != nil, !unit.isEmpty {
                                Text(unit).font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private var coveragePanel: some View {
        Panel(title: "Coverage") {
            HStack(alignment: .top, spacing: 8) {
                Stat(label: "Days", value: "\(store.dashboard?.coverage?.days ?? 0)")
                Stat(label: "Food entries", value: "\(store.dashboard?.coverage?.foodEntries ?? 0)")
            }
        }
    }
}

/// One logged entry: swipe left to reveal three real buttons — Edit, Add as a meal,
/// Delete — each its own rectangle, the way Mail's swipe actions work. No menu, no
/// second tap to get a list of choices; the swipe already is the menu. A standalone
/// struct rather than inline in the ForEach because the swipe needs its own per-row
/// drag state, which only works with real view identity, not a closure.
///
/// The row's own background is the *panel's* color, not a card-toned "surface" color —
/// using surface here was the bug that made every row read as a smaller card nested
/// inside the section's card, when it should look like one seamless list.
struct FoodEntryRow: View {
    @Environment(AppStore.self) private var store
    @Environment(\.colorScheme) private var scheme
    let entry: FoodEntry
    let selecting: Bool
    let selected: Bool
    let highlighted: Bool
    var onToggleSelect: () -> Void
    var onEdit: () -> Void
    /// Raised the moment this row claims a horizontal drag, so the dashboard's own
    /// day-paging swipe stands down. Both gestures are live at once (the page one is a
    /// `simultaneousGesture`, deliberately, so it can coexist with vertical scrolling),
    /// and without this a swipe to reveal a row's actions dragged the whole day sideways
    /// underneath it. The row wins because it engages at 8pt and the page waits for 40:
    /// by the time the page gesture could act, this is already set.
    @Binding var rowSwiping: Bool

    /// The one source of truth for the row's horizontal position — set directly by the
    /// gesture, not summed with a separate `@GestureState`. That combination is why the
    /// old version was glitchy: `@GestureState` snaps back to zero the instant a drag
    /// ends, un-animated, in the same beat `.onEnded`'s `withAnimation` was setting the
    /// committed offset — for one frame the row visibly jumped to zero before animating
    /// to where it was actually headed. A single `@State` updated every frame has
    /// nothing to desync against.
    @State private var offset: CGFloat = 0
    @State private var dragStartOffset: CGFloat = 0
    @State private var isDragging = false
    private let actionWidth: CGFloat = 64
    private var revealWidth: CGFloat { actionWidth * 3 }

    /// The saved meal this entry already exists as, if any — matched on the name it
    /// would be saved under, so a meal saved from this food is recognised however it was
    /// capitalised or spaced at the time.
    private var savedAsMeal: SavedMeal? { store.savedMeal(matching: entry.food) }

    var body: some View {
        ZStack(alignment: .trailing) {
            actionsStrip
            row
                .background(Palette.panel(scheme))
                .offset(x: offset)
                // A UIKit pan rather than a SwiftUI DragGesture, because only the former
                // can decline a touch before recognising it. A DragGesture — plain or
                // simultaneous — takes the touch the moment it moves far enough in any
                // direction, which turned every food row into a spot where the page
                // would not scroll. See HorizontalPan.
                .gesture(swipeGesture)
                .onTapGesture { if offset != 0 { close() } }
        }
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    /// Ordered so the button nearest the row's edge — the one a short swipe reveals
    /// first — is Delete, matching the platform convention (Mail, Messages) where the
    /// destructive action sits closest and everything else needs a fuller swipe.
    private var actionsStrip: some View {
        HStack(spacing: 0) {
            actionButton("Edit", "pencil", .gray) { close(); onEdit() }
            // A filled bookmark and "Added" once this food is in the meal library, and
            // tapping it there takes it back out — so the same control both states the
            // fact and undoes it, rather than silently saving a second copy.
            if let saved = savedAsMeal {
                actionButton("Added", "bookmark.fill", DashboardTheme.shared.accent) {
                    close()
                    Task { await store.deleteSavedMeal(saved) }
                }
            } else {
                actionButton("Add", "bookmark", DashboardTheme.shared.accent) {
                    close()
                    Task { await store.saveMeal(named: entry.food, fromEntryIDs: [entry.id]) }
                }
            }
            actionButton("Delete", "trash", .red) {
                close()
                Task { await store.deleteFood(entry) }
            }
        }
    }

    private func actionButton(_ title: String, _ systemImage: String, _ color: Color,
                              action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: systemImage)
                Text(title).font(.system(size: 10))
            }
            .frame(width: actionWidth)
            .frame(maxHeight: .infinity)
            .foregroundStyle(.white)
        }
        .background(color)
    }

    private func close() { withAnimation(.interactiveSpring(response: 0.3, dampingFraction: 0.86)) { offset = 0 } }

    /// Only ever fires for drags already judged horizontal — a vertical one is declined
    /// before recognition and left to the scroll view, so this row is not a dead spot on
    /// the page. See HorizontalPan.
    private var swipeGesture: HorizontalPan {
        HorizontalPan { translation in
            guard !selecting else { return }
            if !isDragging { isDragging = true; dragStartOffset = offset; rowSwiping = true }
            // The row follows the finger exactly, clamped to the reveal strip — no
            // animation here, so there is zero lag between touch and motion.
            offset = max(-revealWidth, min(0, dragStartOffset + translation))
        } onEnded: { _, predicted in
            guard isDragging else { return }
            isDragging = false
            rowSwiping = false
            guard !selecting else { return }
            // A fast flick opens or closes it even short of the halfway point: `predicted`
            // is where the drag would land if it kept going at its release velocity,
            // which is what makes a quick swipe feel decisive instead of requiring a
            // full, deliberate drag every time.
            let settled = dragStartOffset + predicted
            withAnimation(.interactiveSpring(response: 0.3, dampingFraction: 0.86)) {
                offset = settled < -revealWidth / 2 ? -revealWidth : 0
            }
        }
    }

    private var row: some View {
        HStack(alignment: .firstTextBaseline) {
            if selecting {
                Button(action: onToggleSelect) {
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(selected ? DashboardTheme.shared.accent : Palette.muted(scheme))
                }
                .buttonStyle(.plain)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.food ?? entry.meal ?? "—")
                    .font(.system(size: 15, weight: .medium)).foregroundStyle(Palette.ink(scheme))
                Text([entry.time, entry.meal, entry.portion, entry.place]
                    .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption).foregroundStyle(Palette.muted(scheme))
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(entry.calories == nil ? "—" : "\(Format.kcal(entry.calories)) kcal")
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                Text("\(Format.number(entry.protein, decimals: 1))p · \(Format.number(entry.carbs, decimals: 1))c · \(Format.number(entry.fat, decimals: 1))f · \(Format.number(entry.fiber, decimals: 1))fib")
                    .font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
            }
        }
        .padding(.vertical, 6)
        .padding(.horizontal, highlighted ? 8 : 0)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(DashboardTheme.shared.accent.opacity(highlighted ? 0.18 : 0))
        )
        .animation(.easeInOut(duration: 0.4), value: highlighted)
    }
}

/// The website's NUTRIENT_DISPLAY, transcribed — same keys, labels, units and precision,
/// so a number reads identically on both surfaces.
struct Nutrient {
    let key: String, label: String, unit: String, decimals: Int

    static let display: [Nutrient] = [
        .init(key: "sugarsG", label: "Total sugars", unit: "g", decimals: 1),
        .init(key: "addedSugarsG", label: "Added sugars", unit: "g", decimals: 1),
        .init(key: "sodiumMg", label: "Sodium", unit: "mg", decimals: 0),
        .init(key: "caffeineMg", label: "Caffeine", unit: "mg", decimals: 0),
        .init(key: "saturatedFatG", label: "Saturated fat", unit: "g", decimals: 1),
        .init(key: "transFatG", label: "Trans fat", unit: "g", decimals: 1),
        .init(key: "monounsaturatedFatG", label: "Monounsaturated fat", unit: "g", decimals: 1),
        .init(key: "polyunsaturatedFatG", label: "Polyunsaturated fat", unit: "g", decimals: 1),
        .init(key: "omega3G", label: "Omega-3", unit: "g", decimals: 2),
        .init(key: "omega6G", label: "Omega-6", unit: "g", decimals: 2),
        .init(key: "cholesterolMg", label: "Cholesterol", unit: "mg", decimals: 0),
        .init(key: "starchG", label: "Starch", unit: "g", decimals: 1),
        .init(key: "sugarAlcoholG", label: "Sugar alcohol", unit: "g", decimals: 1),
        .init(key: "potassiumMg", label: "Potassium", unit: "mg", decimals: 0),
        .init(key: "calciumMg", label: "Calcium", unit: "mg", decimals: 0),
        .init(key: "ironMg", label: "Iron", unit: "mg", decimals: 1),
        .init(key: "magnesiumMg", label: "Magnesium", unit: "mg", decimals: 0),
        .init(key: "phosphorusMg", label: "Phosphorus", unit: "mg", decimals: 0),
        .init(key: "zincMg", label: "Zinc", unit: "mg", decimals: 1),
        .init(key: "copperMg", label: "Copper", unit: "mg", decimals: 2),
        .init(key: "manganeseMg", label: "Manganese", unit: "mg", decimals: 2),
        .init(key: "seleniumMcg", label: "Selenium", unit: "mcg", decimals: 1),
        .init(key: "iodineMcg", label: "Iodine", unit: "mcg", decimals: 1),
        .init(key: "vitaminAMcg", label: "Vitamin A", unit: "mcg", decimals: 0),
        .init(key: "vitaminCMg", label: "Vitamin C", unit: "mg", decimals: 1),
        .init(key: "vitaminDMcg", label: "Vitamin D", unit: "mcg", decimals: 1),
        .init(key: "vitaminEMg", label: "Vitamin E", unit: "mg", decimals: 1),
        .init(key: "vitaminKMcg", label: "Vitamin K", unit: "mcg", decimals: 1),
        .init(key: "thiaminMg", label: "Thiamin (B1)", unit: "mg", decimals: 2),
        .init(key: "riboflavinMg", label: "Riboflavin (B2)", unit: "mg", decimals: 2),
        .init(key: "niacinMg", label: "Niacin (B3)", unit: "mg", decimals: 1),
        .init(key: "pantothenicAcidMg", label: "Pantothenic acid (B5)", unit: "mg", decimals: 1),
        .init(key: "vitaminB6Mg", label: "Vitamin B6", unit: "mg", decimals: 2),
        .init(key: "biotinMcg", label: "Biotin (B7)", unit: "mcg", decimals: 1),
        .init(key: "folateMcg", label: "Folate (B9)", unit: "mcg", decimals: 0),
        .init(key: "vitaminB12Mcg", label: "Vitamin B12", unit: "mcg", decimals: 1),
        .init(key: "cholineMg", label: "Choline", unit: "mg", decimals: 0),
        .init(key: "waterMl", label: "Water", unit: "mL", decimals: 0),
        .init(key: "alcoholG", label: "Alcohol", unit: "g", decimals: 1),
    ]
}

/// The website's calorie ring (.ring — a conic-gradient donut), transcribed: a hard
/// black arc on a light track, capped at 100%, with the value and target centred.
struct CalorieRing: View {
    @Environment(\.colorScheme) private var scheme
    let value: Double?
    let target: Double?
    let unit: String

    private var pct: Double {
        guard let value, let target, target > 0 else { return 0 }
        return min(1, max(0, value / target))
    }

    var body: some View {
        ZStack {
            Circle().stroke(Palette.surface(scheme), lineWidth: 16)
            Circle()
                .trim(from: 0, to: pct)
                .stroke(Palette.ink(scheme), style: StrokeStyle(lineWidth: 16, lineCap: .butt))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 2) {
                Text(Format.number(value)).font(.system(size: 26, weight: .semibold, design: .rounded))
                    .foregroundStyle(Palette.ink(scheme))
                Text("of \(Format.number(target)) \(unit)").font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
            }
        }
        .frame(width: 148, height: 148)
    }
}

/// The website's Activity Rings card (.activity-rings): a fixed dark tile — not
/// theme-adaptive, same as the website's own #202124 — with Apple's own Move/Exercise/
/// Stand ring colours, since this one card is deliberately the app's other splash of
/// colour besides the flame mark.
struct ActivityRingsCard: View {
    let move: Double
    let moveTarget: Double
    let exercise: Double
    let exerciseTarget: Double
    let stand: Double
    let standTarget: Double

    private static let moveColor = Color(hex: 0xff2d55)
    private static let moveTrack = Color(hex: 0x54162a)
    private static let exerciseColor = Color(hex: 0xa8ff00)
    private static let exerciseTrack = Color(hex: 0x35510a)
    private static let standColor = Color(hex: 0x00e5f0)
    private static let standTrack = Color(hex: 0x07515a)

    var body: some View {
        HStack(spacing: 24) {
            ZStack {
                ring(move, moveTarget, track: Self.moveTrack, progress: Self.moveColor, lineWidth: 20, diameter: 168)
                ring(exercise, exerciseTarget, track: Self.exerciseTrack, progress: Self.exerciseColor, lineWidth: 18, diameter: 118)
                ring(stand, standTarget, track: Self.standTrack, progress: Self.standColor, lineWidth: 16, diameter: 76)
            }
            .frame(width: 168, height: 168)
            VStack(alignment: .leading, spacing: 16) {
                ringRow("Move", move, moveTarget, "CAL", Self.moveColor)
                ringRow("Exercise", exercise, exerciseTarget, "MIN", Self.exerciseColor)
                ringRow("Stand", stand, standTarget, "MIN", Self.standColor)
            }
            Spacer(minLength: 0)
        }
        .padding(20)
        .background(Color(hex: 0x202124))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func ring(_ value: Double, _ target: Double, track: Color, progress: Color, lineWidth: CGFloat, diameter: CGFloat) -> some View {
        let pct = target > 0 ? min(1, max(0, value / target)) : 0
        return ZStack {
            Circle().stroke(track, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: pct)
                .stroke(progress, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .frame(width: diameter, height: diameter)
    }

    private func ringRow(_ label: String, _ value: Double, _ target: Double, _ unit: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.system(size: 13)).foregroundStyle(.white.opacity(0.85))
            HStack(alignment: .lastTextBaseline, spacing: 4) {
                Text("\(Format.number(value))/\(Format.number(target))")
                    .font(.system(size: 22, weight: .medium, design: .rounded))
                Text(unit).font(.system(size: 11, weight: .bold))
            }
            .foregroundStyle(color)
        }
    }
}

/// The website's InteractiveLine (ink line + soft area fill), simplified to native
/// Charts: no draggable tooltip, but the same shape, colour and one-glance readability.
struct TrendLineChart: View {
    @Environment(\.colorScheme) private var scheme
    let title: String
    let unit: String
    let decimals: Int
    let points: [(date: String, value: Double)]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.ink(scheme))
            if points.count < 2 {
                Text("Insufficient data").font(.footnote).foregroundStyle(Palette.muted(scheme))
                    .frame(maxWidth: .infinity, minHeight: 80, alignment: .center)
            } else {
                Chart(points, id: \.date) { point in
                    AreaMark(x: .value("Date", point.date), y: .value(unit, point.value))
                        .foregroundStyle(.linearGradient(colors: [Palette.ink(scheme).opacity(0.16), .clear],
                                                         startPoint: .top, endPoint: .bottom))
                        .interpolationMethod(.monotone)
                    LineMark(x: .value("Date", point.date), y: .value(unit, point.value))
                        .foregroundStyle(Palette.ink(scheme))
                        .interpolationMethod(.monotone)
                }
                .chartXAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
                .chartYAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
                .frame(height: 150)
            }
        }
    }
}

// MARK: - Jiggle-mode plumbing

private extension View {
    /// The Home Screen wobble: a small looping rotation, out of phase per card (seeded
    /// from its key) so a whole screen of cards doesn't move in lockstep.
    func jiggling(_ active: Bool, seed: String) -> some View {
        modifier(JiggleModifier(active: active, seed: seed))
    }
}

private struct JiggleModifier: ViewModifier {
    let active: Bool
    let seed: String
    @State private var tilted = false

    private var delay: Double { Double(abs(seed.hashValue) % 70) / 1000 }

    func body(content: Content) -> some View {
        content
            .rotationEffect(.degrees(active ? (tilted ? -1.4 : 1.4) : 0))
            .animation(active ? .easeInOut(duration: 0.14).delay(delay).repeatForever(autoreverses: true) : .default, value: tilted)
            .onAppear { if active { tilted = true } }
            .onChange(of: active) { _, isActive in tilted = isActive }
    }
}

/// Reorders draftLayout.order live as one card drags over another, mirroring how
/// Home Screen icons swap position mid-drag rather than only on release.
private struct SectionDropDelegate: DropDelegate {
    let item: String
    @Binding var layout: DashboardLayout
    @Binding var draggingItem: String?

    func dropEntered(info: DropInfo) {
        guard let dragging = draggingItem, dragging != item,
              let from = layout.order.firstIndex(of: dragging),
              let to = layout.order.firstIndex(of: item) else { return }
        withAnimation {
            layout.order.move(fromOffsets: IndexSet(integer: from), toOffset: to > from ? to + 1 : to)
        }
    }

    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }
    func performDrop(info: DropInfo) -> Bool { draggingItem = nil; return true }
}

// MARK: - Energy trend charts (top of dashboard)

/// The website's NetBalanceChart: one bar per day, up for surplus, down for deficit,
/// split by a zero line.
struct NetBalanceTrendChart: View {
    @Environment(\.colorScheme) private var scheme
    let trends: [DaySummary]

    @State private var visibleCount: Double
    @GestureState private var magnifyBy: CGFloat = 1
    @State private var selectedDate: String?

    /// Today plus the previous three. A month of daily bars at phone width is a smear,
    /// and the question this chart answers is almost always about the last few days.
    private static let defaultWindow = 4

    init(trends: [DaySummary]) {
        self.trends = trends
        _visibleCount = State(initialValue: Double(min(Self.defaultWindow, max(trends.count, 1))))
    }

    /// The trailing slice of `points` currently shown, sized by pinch and always
    /// anchored on the most recent day. No drag-to-scroll: `chartScrollableAxes` sat
    /// inside Today's outer vertical ScrollView, and a diagonal drag could trigger both
    /// at once, which read as the whole dashboard being freely draggable instead of a
    /// chart with its own scroll. Pinch can't cause that ambiguity — it needs a second
    /// finger a page-scroll never provides — so it is the only way to widen the window.
    private var visibleDates: [String] {
        let count = min(points.count, max(3, Int((visibleCount / magnifyBy).rounded())))
        return points.suffix(count).map(\.date)
    }

    private var points: [(date: String, net: Double?)] {
        trends.map { day in
            let net: Double? = (day.caloriesConsumed != nil && day.totalExpenditure != nil)
                ? day.caloriesConsumed! - day.totalExpenditure! : nil
            return (day.date, net)
        }
    }

    /// "Mon Aug 11" — an ISO date on a tick mark is unreadable at a glance, and the
    /// weekday is most of why anyone looks at this chart ("what happened on Saturday?").
    static func label(for iso: String) -> String {
        guard let date = Self.isoFormatter.date(from: iso) else { return iso }
        return Self.displayFormatter.string(from: date)
    }

    private static let isoFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        f.timeZone = .current
        return f
    }()

    private static let displayFormatter: DateFormatter = {
        let f = DateFormatter()
        f.setLocalizedDateFormatFromTemplate("EEE MMM d")
        return f
    }()

    private var selectedPoint: (date: String, net: Double?)? {
        guard let selectedDate else { return nil }
        return points.first { $0.date == selectedDate }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Daily deficit and surplus").font(.system(size: 13, weight: .semibold)).foregroundStyle(Palette.ink(scheme))
                Spacer()
                if points.count > Self.defaultWindow {
                    Text("Tap a bar · pinch for more history").font(.system(size: 10)).foregroundStyle(Palette.muted(scheme))
                }
            }
            if points.allSatisfy({ $0.net == nil }) {
                Text("No energy balance data yet").font(.footnote).foregroundStyle(Palette.muted(scheme))
                    .frame(maxWidth: .infinity, minHeight: 60, alignment: .center)
            } else {
                HStack(spacing: 14) {
                    legendDot("Surplus", DashboardTheme.shared.positive)
                    legendDot("Deficit", DashboardTheme.shared.negative)
                    Spacer(minLength: 0)
                    // Reads out the tapped bar. Sits in the header rather than as a
                    // floating annotation so it can't be clipped by the plot area or
                    // cover the neighbouring bars.
                    if let selected = selectedPoint, let net = selected.net {
                        Text("\(Self.label(for: selected.date)) · \(Format.number(abs(net))) kcal \(net > 0 ? "surplus" : "deficit")")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(net > 0 ? DashboardTheme.shared.positive : DashboardTheme.shared.negative)
                            .lineLimit(1)
                    }
                }
                Chart {
                    RuleMark(y: .value("Zero", 0)).foregroundStyle(Palette.border(scheme))
                    ForEach(points, id: \.date) { point in
                        if let net = point.net {
                            BarMark(x: .value("Date", point.date), y: .value("kcal", net))
                                .foregroundStyle(net > 0 ? DashboardTheme.shared.positive : DashboardTheme.shared.negative)
                                // The tapped bar keeps full colour; the rest recede, so
                                // the selection reads without adding another element.
                                .opacity(selectedDate == nil || selectedDate == point.date ? 1 : 0.35)
                        }
                    }
                }
                .chartLegend(.hidden)
                .chartXAxis {
                    AxisMarks(values: .automatic(desiredCount: 3)) { value in
                        AxisGridLine()
                        AxisTick()
                        AxisValueLabel {
                            if let iso = value.as(String.self) { Text(Self.label(for: iso)) }
                        }
                    }
                }
                .chartYAxis { AxisMarks(values: .automatic(desiredCount: 3)) }
                // Same shape as the website's own horizontally-scrolled bar strip, minus
                // the scrolling: pinch adjusts how many days are visible at once,
                // matching the website's implicit zoom via its own bar width, and the
                // window always trails the most recent day rather than being draggable.
                .chartXScale(domain: visibleDates)
                // A plain tap that toggles, instead of chartXSelection's press-and-hold
                // (which also clears the moment you lift, so a reading never stayed up).
                //
                // simultaneousGesture, not onTapGesture: an overlay that is hit-testable
                // sits above the chart's own scroll view, and a plain tap handler there
                // consumes the drag before the scroll view sees it — which is exactly how
                // this chart stopped scrolling. Recognising alongside leaves the drag to
                // the scroll view and the tap to us.
                .chartOverlay { proxy in
                    GeometryReader { geo in
                        Rectangle().fill(.clear).contentShape(Rectangle())
                            .simultaneousGesture(
                                SpatialTapGesture().onEnded { value in
                                    guard let plot = proxy.plotFrame else { return }
                                    let x = value.location.x - geo[plot].origin.x
                                    guard let date: String = proxy.value(atX: x) else { return }
                                    selectedDate = (selectedDate == date) ? nil : date
                                }
                            )
                    }
                }
                .simultaneousGesture(
                    MagnificationGesture()
                        .updating($magnifyBy) { value, state, _ in state = value }
                        .onEnded { value in
                            visibleCount = min(Double(points.count), max(3, visibleCount / value))
                        }
                )
                .frame(height: 130)
            }
        }
    }

    private func legendDot(_ label: String, _ color: Color) -> some View {
        HStack(spacing: 4) {
            Capsule().fill(color).frame(width: 14, height: 5)
            Text(label).font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
        }
    }
}

/// The website's EnergySummary: the box grid (2 columns, same 5-6 keys, the balance
/// box's label and colour flipping between Deficit/Surplus by sign) plus the two-track
/// segmented bar underneath it — burned (resting+active, stacked) above consumed, with
/// a hatched "gap" spanning the difference between them, labelled with the amount.
struct EnergySummaryBars: View {
    @Environment(\.colorScheme) private var scheme
    let summary: DaySummary?
    let rolling24h: Rolling24h?
    let boxes: [String]

    private var resting: Double { summary?.restingEnergy ?? 0 }
    private var active: Double { summary?.activeEnergy ?? 0 }
    private var total: Double { summary?.totalExpenditure ?? (resting + active) }
    private var consumed: Double { summary?.caloriesConsumed ?? 0 }
    private var balance: Double { total - consumed }
    private var balanceWord: String { balance >= 0 ? "Deficit" : "Surplus" }
    private var balanceAmount: Double { abs(balance) }
    private var maxVal: Double { max(total, max(consumed, 1)) }

    private struct BoxDef { var key: String; var color: Color; var label: String; var value: Double; var tinted: Bool }

    private var boxDefs: [BoxDef] {
        let theme = DashboardTheme.shared
        var defs = [
            BoxDef(key: "totalBurned", color: Palette.muted(scheme), label: "Total burned", value: total, tinted: false),
            BoxDef(key: "consumed", color: theme.consumed, label: "Consumed", value: consumed, tinted: false),
            BoxDef(key: "active", color: theme.secondary, label: "Active", value: active, tinted: false),
            BoxDef(key: "resting", color: theme.tertiary, label: "Resting", value: resting, tinted: false),
            BoxDef(key: "deficit", color: theme.primary, label: balanceWord, value: balanceAmount, tinted: true),
        ]
        if let r = rolling24h?.balance {
            let isDeficit = r < 0
            defs.append(BoxDef(key: "rolling24", color: theme.primary, label: "24h \(isDeficit ? "deficit" : "surplus")",
                               value: abs(r), tinted: true))
        }
        return defs.filter { boxes.contains($0.key) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if !boxDefs.isEmpty {
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                    ForEach(boxDefs, id: \.key) { def in
                        HStack(spacing: 0) {
                            VStack(alignment: .leading, spacing: 5) {
                                HStack(spacing: 6) {
                                    Circle().fill(def.color).frame(width: 7, height: 7)
                                    Text(def.label).font(.system(size: 12))
                                        .foregroundStyle(def.tinted ? DashboardTheme.shared.primary : Palette.muted(scheme))
                                }
                                Text("\(Format.number(def.value)) kcal")
                                    .font(.system(size: 19, weight: .semibold, design: .rounded))
                                    .foregroundStyle(def.tinted ? DashboardTheme.shared.primary : Palette.ink(scheme))
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(12)
                        .background(def.tinted ? DashboardTheme.shared.primary.opacity(0.1) : Palette.surface(scheme))
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(def.tinted ? DashboardTheme.shared.primary.opacity(0.35) : .clear, lineWidth: 1)
                        )
                    }
                }
            }

            VStack(alignment: .leading, spacing: 6) {
                // Track 1: total burned, split into resting + active.
                GeometryReader { geo in
                    let w = geo.size.width
                    ZStack(alignment: .leading) {
                        Capsule().fill(Palette.surface(scheme))
                        HStack(spacing: 0) {
                            Rectangle().fill(DashboardTheme.shared.tertiary).frame(width: max(0, w * resting / maxVal))
                            Rectangle().fill(DashboardTheme.shared.secondary).frame(width: max(0, w * active / maxVal))
                        }
                        .clipShape(Capsule())
                    }
                }
                .frame(height: 14)

                // Track 2: consumed, plus a hatched gap spanning the difference.
                GeometryReader { geo in
                    let w = geo.size.width
                    let gapStart = min(total, consumed) / maxVal
                    let gapWidth = abs(total - consumed) / maxVal
                    ZStack(alignment: .leading) {
                        Capsule().fill(Palette.surface(scheme))
                        Rectangle().fill(DashboardTheme.shared.consumed).frame(width: max(0, w * consumed / maxVal))
                            .clipShape(Capsule())
                        if balanceAmount > 0 {
                            ZStack {
                                DiagonalStripes(color: DashboardTheme.shared.primary)
                                if gapWidth > 0.16 {
                                    // Ink, not the accent: this sits on top of a hatched
                                    // fill in that same accent, so tinting it too left
                                    // the label barely legible against its own stripes.
                                    Text("\(Format.number(balanceAmount)) kcal \(balanceWord.lowercased())")
                                        .font(.system(size: 9, weight: .semibold))
                                        .foregroundStyle(Palette.ink(scheme))
                                        .lineLimit(1)
                                        .minimumScaleFactor(0.6)
                                }
                            }
                            .frame(width: max(0, w * gapWidth), height: 14)
                            .clipShape(Capsule())
                            .offset(x: w * gapStart)
                        }
                    }
                }
                .frame(height: 14)
            }

            HStack(spacing: 14) {
                legendDot("Resting", DashboardTheme.shared.tertiary)
                legendDot("Active", DashboardTheme.shared.secondary)
                legendDot("Consumed", Palette.ink(scheme))
                legendDot("\(balanceWord) gap", DashboardTheme.shared.primary)
            }
        }
    }

    private func legendDot(_ label: String, _ color: Color) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 7, height: 7)
            Text(label).font(.system(size: 11)).foregroundStyle(Palette.muted(scheme))
        }
    }
}

/// A tiled diagonal-hatch fill, for the balance "gap" region — the same visual idea as
/// the website's repeating-gradient stripe, drawn natively since SwiftUI has no CSS
/// equivalent.
private struct DiagonalStripes: View {
    let color: Color

    var body: some View {
        Canvas { context, size in
            let spacing: CGFloat = 6
            var x = -size.height
            while x < size.width {
                var path = Path()
                path.move(to: CGPoint(x: x, y: size.height))
                path.addLine(to: CGPoint(x: x + size.height, y: 0))
                context.stroke(path, with: .color(color.opacity(0.6)), lineWidth: 2)
                x += spacing
            }
        }
        .background(color.opacity(0.16))
    }
}
