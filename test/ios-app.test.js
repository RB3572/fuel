import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const mlog = read('../api/mlog.js')

// The Fuel iOS app (ios/Fuel) talks to this same API with an OAuth access token rather
// than a pasted sync token. Behavioural coverage runs against real Postgres in the
// PGlite harness; these pin the wiring and the security property.

test('the dashboard API accepts OAuth access tokens, scoped', () => {
  assert.match(mlog, /import \{ authorizationServerMetadata, verifyAccessToken \}/)
  assert.match(mlog, /const granted = verifyAccessToken\(token, requiredScopes\)/)
  // Reads need fuel:read, writes need fuel:write — a read-only grant must not be able
  // to log or delete food.
  assert.match(mlog, /authenticatedUser\(req, req\.method === 'GET' \? \['fuel:read'\] : \['fuel:write'\]\)/)
})

test('the long-lived sync token still works alongside OAuth', () => {
  // Health Logger and the legacy Shortcut authenticate this way; adding OAuth must not
  // have replaced it.
  assert.match(mlog, /const user = await userForSyncToken\(token\)\.catch\(\(\) => null\)/)
  assert.match(mlog, /if \(user\) return \{ id: user\.id, cookie: null \}/)
})

test('the iOS app signs in with PKCE and never stores a password', () => {
  const signIn = read('../ios/Fuel/Sources/SignIn.swift')
  assert.match(signIn, /ASWebAuthenticationSession/)
  assert.match(signIn, /code_challenge/)
  // A client ID may ship — iOS OAuth clients are public by design. A secret may not.
  assert.doesNotMatch(signIn, /client_secret/)
  assert.doesNotMatch(signIn, /GOCSPX/)
})

test('the AI runs on device by default, not through Gemini', () => {
  const ai = read('../ios/Fuel/Sources/OnDeviceAI.swift')
  assert.match(ai, /import FoundationModels/)
  assert.match(ai, /SystemLanguageModel\.default/)
  // OnDeviceAI is the router, not a network client: every remote call must go through
  // RemoteAI.* rather than OnDeviceAI reaching for a hosted endpoint or URLSession
  // itself. Checked against the endpoint and against network calls in this file
  // specifically, since the prose here legitimately explains what it replaced.
  assert.doesNotMatch(ai, /generativelanguage\.googleapis\.com|api\.openai\.com|api\.anthropic\.com/)
  assert.doesNotMatch(ai, /URLSession/)
  const store = read('../ios/Fuel/Sources/AppStore.swift')
  assert.doesNotMatch(store, /generativelanguage\.googleapis\.com/)
})

test('every OnDeviceAI method checks for a remote key before running on device', () => {
  const ai = read('../ios/Fuel/Sources/OnDeviceAI.swift')
  for (const call of ['estimateNutrition', 'estimateRecipeNutrition', 'identifyMeal', 'dailyInsight', 'planRestOfDay', 'ask']) {
    assert.match(ai, new RegExp(`RemoteAI\\.${call}\\(`), `${call} never routes to RemoteAI — a configured key would silently be ignored`)
  }
})

test('a bring-your-own-key request only fires when a key is actually present', () => {
  const keyStore = read('../ios/Fuel/Sources/APIKeyStore.swift')
  // A provider can be *selected* with no key typed in yet; activeProvider must read
  // that as "use on-device", not attempt a request with an empty key.
  assert.match(keyStore, /var activeProvider: AIProvider\? \{/)
  assert.match(keyStore, /key\.isEmpty \? nil : selectedProvider/)
  // Keychain only — same mechanism as the health sync token, never UserDefaults, which
  // is unencrypted and included in unencrypted device backups. (selectedProvider, an
  // enum case rather than a secret, is fine in UserDefaults — only the raw key value
  // typed in via setKey, bound to `trimmed`, is checked here.)
  assert.match(keyStore, /Keychain\.set\(trimmed, for: provider\.keychainKey\)/)
  assert.doesNotMatch(keyStore, /UserDefaults\.standard\.set\(trimmed/)
})

test('the BYOK model is picked from a live per-provider list, never hardcoded into a request', () => {
  const keyStore = read('../ios/Fuel/Sources/APIKeyStore.swift')
  const remote = read('../ios/Fuel/Sources/RemoteAI.swift')
  const onDevice = read('../ios/Fuel/Sources/OnDeviceAI.swift')
  const more = read('../ios/Fuel/Sources/MoreView.swift')

  // A provider that retires a model (this is what actually happened to
  // gemini-2.5-flash) must only ever mean editing APIKeyStore's list — never a
  // silently-broken literal string buried in a request body.
  assert.doesNotMatch(remote, /"model":\s*"[a-z0-9.\-]+"/)
  for (const provider of ['claude', 'openAI', 'gemini']) {
    assert.match(keyStore, new RegExp(`case \\.${provider}: return \\[`), `${provider} needs a model list`)
  }
  assert.match(keyStore, /var defaultModel: String \{ availableModels\[1\]\.modelID \}/)
  // A stored pick that's no longer offered (the provider retired it) falls back to the
  // current default rather than sending a dead model ID.
  assert.match(keyStore, /provider\.availableModels\.contains\(where: \{ \$0\.modelID == stored \}\)/)

  // The chosen model actually reaches every RemoteAI call, not just some of them.
  assert.match(onDevice, /var remote: \(provider: AIProvider, key: String, model: String\)\?/)
  for (const call of ['estimateNutrition', 'estimateRecipeNutrition', 'identifyMeal', 'dailyInsight', 'planRestOfDay', 'ask']) {
    assert.match(onDevice, new RegExp(`RemoteAI\\.${call}\\([^)]*model: remote\\.model`, 's'), `${call} must pass remote.model through`)
  }

  // Reachable from the same picker as the key and provider, not a hidden default.
  assert.match(more, /Picker\("Model", selection: modelBinding\)/)
  assert.match(more, /ForEach\(keyStore\.selectedProvider\.availableModels\)/)
})

test('remote providers only ever run when OnDeviceAI.remote resolves a key', () => {
  const remote = read('../ios/Fuel/Sources/RemoteAI.swift')
  // Every provider function requires a non-optional `key` parameter — there is no path
  // that silently defaults to an empty string and fires an unauthenticated request.
  assert.match(remote, /private static func completeClaude\(key: String/)
  assert.match(remote, /private static func completeOpenAI\(key: String/)
  assert.match(remote, /private static func completeGemini\(key: String/)
  assert.match(remote, /guard !key\.isEmpty else \{ throw RemoteAIError\.missingKey\(provider\) \}/)
})

test('the dashboard\'s accent colors are user-customizable, with presets and a full custom picker', () => {
  const theme = read('../ios/Fuel/Sources/DashboardTheme.swift')
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  // More than one built-in palette to choose from, plus a fully custom option.
  assert.match(theme, /static let presets: \[DashboardPalette\] = \[/)
  const presetCount = [...theme.matchAll(/DashboardPalette\(name: "/g)].length
  assert.ok(presetCount >= 3, `expected several preset palettes, found ${presetCount}`)
  assert.match(theme, /ColorPicker\("Accent"/)
  assert.match(theme, /ColorPicker\("Active energy"/)
  assert.match(theme, /ColorPicker\("Resting energy"/)
  // Colors aren't secret, but they should still survive a relaunch.
  assert.match(theme, /d\.set\(primary\.hexString, forKey:/)
  // The picker is reachable from the dashboard's own menu, not buried in More.
  assert.match(today, /Button \{ showColors = true \} label: \{ Label\("Dashboard colors"/)
  assert.match(today, /\.sheet\(isPresented: \$showColors\) \{ DashboardColorsSheet\(\) \}/)
  // The energy boxes and both dashboard charts read the live theme rather than a
  // hardcoded hex — the whole point of the feature is that changing it is visible.
  assert.doesNotMatch(today, /0x7d8fa3|0xef8f4d/i)
  for (const usage of [
    /BoxDef\(key: "active", color: theme\.secondary/,
    /BoxDef\(key: "resting", color: theme\.tertiary/,
    /BoxDef\(key: "deficit", color: theme\.primary/,
    /legendDot\("Active", DashboardTheme\.shared\.secondary\)/,
    /legendDot\("Resting", DashboardTheme\.shared\.tertiary\)/,
  ]) {
    assert.match(today, usage)
  }
})

test('nothing claims to run on device while a remote key is doing the work', () => {
  // Saying "on device" while the question is in flight to someone's own Gemini key is
  // a privacy claim that isn't true — every such string is conditioned on the provider.
  for (const [file, marker] of [
    ['../ios/Fuel/Sources/CoachView.swift', 'Thinking'],
    ['../ios/Fuel/Sources/CameraLogView.swift', 'Reading your photo'],
  ]) {
    const source = read(file)
    // The on-device wording may only appear as the `??` fallback of the provider
    // lookup — never as a bare unconditional Text(...).
    assert.doesNotMatch(source, new RegExp(`Text\\("${marker}[^"]*on device`),
      `${file}: "${marker} … on device" must be conditioned on activeProvider`)
    assert.match(source, new RegExp(`activeProvider\\.map \\{ "${marker}`),
      `${file} must name the active provider instead`)
  }
})

test('the palette themes the whole app, not just the Today charts', () => {
  const theme = read('../ios/Fuel/Sources/DashboardTheme.swift')
  // A "Website" preset matching fuel.rishib.com, plus per-palette surplus/deficit
  // colors — sign carries meaning on that chart, so one accent for both loses it.
  assert.match(theme, /DashboardPalette\(name: "Default"/)
  assert.match(theme, /var positive: UInt32/)
  assert.match(theme, /var negative: UInt32/)
  assert.match(theme, /var accent: Color \{ primary \}/)

  // Every user-facing accent reads the theme. Palette.flame survives only as the brand
  // mark (the launch-screen bolt), which must keep matching the Home Screen icon.
  for (const file of ['CoachView', 'Theme', 'CompareView', 'LiftingView', 'TrendsView']) {
    assert.doesNotMatch(read(`../ios/Fuel/Sources/${file}.swift`), /Palette\.flame(?!\w)/,
      `${file}.swift should use DashboardTheme.shared.accent, not the fixed flame`)
  }
  const app = read('../ios/Fuel/Sources/FuelApp.swift')
  assert.match(app, /@State private var theme = DashboardTheme\.shared/)
  assert.match(app, /\.tint\(theme\.accent\)/)

  // The surplus/deficit bars read the two dedicated colors, not the generic accent.
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  assert.match(today, /net > 0 \? DashboardTheme\.shared\.positive : DashboardTheme\.shared\.negative/)
})

test('Trends plots two metrics on independent axes, and every chart zooms', () => {
  const trends = read('../ios/Fuel/Sources/TrendsView.swift')
  const explore = read('../ios/Fuel/Sources/ExploreView.swift')

  // Two pickers, each driving its own vertical axis — steps (~10,000) against sleep
  // (~7h) on one shared domain would flatten the smaller into a straight line.
  assert.match(trends, /metricPicker\(selection: \$primaryKey/)
  assert.match(trends, /metricPicker\(selection: \$secondaryKey/)
  assert.match(trends, /AxisMarks\(position: \.leading/)
  assert.match(trends, /AxisMarks\(position: \.trailing/)
  // The trailing axis is labelled in the secondary metric's own units even though its
  // marks were rescaled into the primary's domain — that inverse is the whole trick.
  assert.match(trends, /trailingAxis\.fromPrimary\(v\)/)
  // A flat series must not divide by zero when rescaled.
  assert.match(trends, /guard sourceSpan > 0 else \{ return target\.min \+ targetSpan \/ 2 \}/)

  // Averages follow the selection rather than always showing the same energy figures.
  assert.match(trends, /Panel\(title: "Averages · last \\\(trends\.count\) days"\)/)
  assert.match(trends, /Stat\(label: primary\.def\.label/)

  // One metric catalogue shared with Explore, so the two can't drift apart.
  assert.match(trends, /private var metrics: \[ExploreMetric\] \{ exploreMetrics \}/)
  // Shared zoom component and one date formatter for every axis. Zoom is pinch-only —
  // a chart-level drag-to-scroll would race the page's own vertical ScrollView on a
  // diagonal drag, which is why that combination was removed.
  assert.match(trends, /struct ZoomableDateChart<Content: ChartContent>: View/)
  assert.doesNotMatch(trends, /\.chartScrollableAxes\(\.horizontal\)/)
  assert.match(trends, /MagnificationGesture\(\)/)
  assert.match(trends, /Text\(DateAxis\.short\(iso\)\)/)
  assert.match(explore, /ZoomableDateChart\(dates:/)
})

test('Explore colours each series correctly and keeps one x-ordering', () => {
  const explore = read('../ios/Fuel/Sources/ExploreView.swift')
  const trends = read('../ios/Fuel/Sources/TrendsView.swift')
  // A literal per-mark colour resolved once for the whole plot, so every line drew in
  // whichever colour came last while the legend showed the right ones.
  assert.match(explore, /\.foregroundStyle\(by: \.value\("Metric", s\.label\)\)/)
  assert.match(explore, /\.chartForegroundStyleScale\(domain: withData\.map\(\\.label\), range: withData\.map\(\\.color\)\)/)
  assert.doesNotMatch(explore, /\.foregroundStyle\(s\.color\)/)
  // Without an explicit domain each series contributed its own categories in its own
  // order, so two metrics with different gaps crossed back over themselves. The domain
  // is now a trailing slice (visibleDates) rather than the full history, since zoom no
  // longer scrolls — but it's still one shared, explicit x-ordering.
  assert.match(trends, /\.chartXScale\(domain: visibleDates\)/)
})

test('Coach replies render markdown instead of showing raw asterisks', () => {
  const md = read('../ios/Fuel/Sources/MarkdownText.swift')
  const coach = read('../ios/Fuel/Sources/CoachView.swift')
  // SwiftUI's own markdown support is inline-only, so block elements need handling or
  // a bulleted reply keeps its literal "- ".
  for (const block of ['heading', 'bullet', 'numbered', 'paragraph']) {
    assert.match(md, new RegExp(`case ${block}`), `block renderer must handle ${block}`)
  }
  assert.match(md, /interpretedSyntax: \.inlineOnlyPreservingWhitespace/)
  // Only the coach's text is markdown; what the person typed is shown as typed.
  assert.match(coach, /MarkdownText\(text: message\.text/)
  assert.match(coach, /if message\.role == \.user \{\s*Text\(message\.text\)/)
})

test('the Coach can act, but nothing mutates without an explicit confirmation', () => {
  const action = read('../ios/Fuel/Sources/CoachAction.swift')
  const coach = read('../ios/Fuel/Sources/CoachView.swift')
  const store = read('../ios/Fuel/Sources/AppStore.swift')

  // The safety property: a proposed change is rendered as a card and applied only on
  // tap. A wrong number in a food log is easy for a model to produce and tedious to
  // find later, so nothing may mutate on the strength of a parse alone.
  assert.match(store, /var pendingAction: CoachAction\?/)
  assert.match(coach, /if message\.pendingAction != nil \{[\s\S]*?ActionConfirmation\(/)
  assert.match(store, /func confirmAction\(_ message: ChatMessage\) async/)
  assert.match(store, /func cancelAction\(_ message: ChatMessage\)/)
  // Execution is reachable only from confirmAction — never straight from interpretation.
  const executeAt = store.indexOf('CoachActions.execute(')
  const confirmAt = store.indexOf('func confirmAction')
  assert.ok(executeAt > confirmAt && executeAt > 0, 'execute must live inside confirmAction')

  // Every kind the interpreter is offered has a branch in the executor, or the Coach
  // would confirm a change and then silently do nothing.
  const kinds = action.match(/static let kinds = \[([\s\S]*?)\]/)[1]
    .split(',').map((s) => s.trim().replace(/"/g, '')).filter(Boolean)
  assert.ok(kinds.length >= 8, `expected the full action surface, got ${kinds.length}`)
  for (const kind of kinds) {
    assert.match(action, new RegExp(`case "${kind}":`), `${kind} has no executor branch`)
  }

  // Appending rather than replacing: saveContext overwrites the whole field, so sending
  // only the new sentence would silently drop everything already stored.
  assert.match(action, /existing\.isEmpty \? addition : existing \+ "\\n" \+ addition/)
})

test('the deficit chart opens on the most recent days and reads out a tapped bar', () => {
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  // The chart always opens on the newest data: its domain is a trailing slice of
  // `points`, anchored off the end of the array rather than any scroll position that
  // could be applied before layout and silently discarded.
  assert.match(today, /private var visibleDates: \[String\] \{/)
  assert.match(today, /points\.suffix\(count\)\.map\(\\\.date\)/)
  assert.doesNotMatch(today, /\.chartScrollPosition\(/)
  // A plain tap that toggles, not chartXSelection's press-and-hold — which also cleared
  // on lift, so a reading never stayed up.
  assert.doesNotMatch(today, /\.chartXSelection\(/)
  assert.match(today, /selectedDate = \(selectedDate == date\) \? nil : date/)
  // Dates read as "Mon Aug 11", not an ISO string on a tick mark.
  assert.match(today, /setLocalizedDateFormatFromTemplate\("EEE MMM d"\)/)
  // The all-time average carries the same two colours as the bars, since its sign is
  // the whole point.
  assert.match(today, /Stat\(label: balance > 0 \? "Avg surplus" : "Avg deficit"/)
  assert.match(today, /tint: balance > 0 \? DashboardTheme\.shared\.positive/)
})

test('the app reads HealthKit itself, sharing one engine with Health Logger', () => {
  const project = read('../ios/Fuel/project.yml')
  // Shared by source path, not copied — two implementations would be two things to
  // keep correct.
  for (const file of ['SyncEngine.swift', 'SyncSink.swift', 'HealthKitCatalog.swift']) {
    assert.match(project, new RegExp(`\\.\\./HealthLogger/Sources/${file}`))
  }
  const background = read('../ios/HealthLogger/Sources/BackgroundSync.swift')
  // Task identifiers derive from the bundle ID so each app registers only its own.
  assert.match(background, /static let refreshTaskID = bundleID \+ "\.refresh"/)
  assert.match(project, /com\.labloggercompany\.fuel\.refresh/)
})

test('logging opens the camera, with typing one tap away', () => {
  const app = read('../ios/Fuel/Sources/FuelApp.swift')
  const camera = read('../ios/Fuel/Sources/CameraLogView.swift')
  assert.match(app, /Tab\("Log", systemImage: "camera\.fill", value: AppTab\.log\) \{ CameraLogView\(\) \}/)
  // Back camera: you are photographing the plate, not yourself.
  assert.match(camera, /position: \.back/)
  // One shutter logs straight away; the blue one stops for context first.
  assert.match(camera, /store\.logPhoto\(data, note: nil\)/)
  assert.match(camera, /askingForContext = true/)
})

test('the dashboard replicates the website: every section, box and nutrient', () => {
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  const web = read('../src/App.tsx')

  // The same eight sections, by the same keys, so a layout saved on either surface
  // means the same thing on the other.
  for (const key of ['nutrition', 'detailedNutrition', 'foodConsumed', 'fitness',
                     'workouts', 'steps', 'vitals', 'recovery']) {
    assert.match(today, new RegExp(`case "${key}"`), `the app must render the ${key} section`)
  }
  // Each box is defined once, keyed by these strings, and shown only when the layout's
  // boxes array contains that key.
  for (const box of ['totalBurned', 'consumed', 'active', 'resting', 'deficit', 'rolling24']) {
    assert.match(today, new RegExp(`BoxDef\\(key: "${box}"`), `${box} must be renderable`)
  }
  assert.match(today, /boxes\.contains\(\$0\.key\)/)

  // The nutrient grid is transcribed, not summarised: every key the website can show,
  // the app can show. A missing one silently renders nothing.
  const webKeys = [...web.matchAll(/\['([a-zA-Z0-9]+)','[^']+','[^']*',\d\]/g)].map((m) => m[1])
  assert.ok(webKeys.length >= 39, `expected the website's nutrient list, found ${webKeys.length}`)
  for (const key of webKeys) {
    assert.match(today, new RegExp(`key: "${key}"`), `nutrient ${key} is missing from the app`)
  }
})

test('the edit controls post the envelopes the server actually reads', () => {
  const client = read('../ios/Fuel/Sources/FuelClient.swift')
  const mlog = read('../api/mlog.js')

  // Both of these answer 200 for a wrongly-shaped body and quietly save nothing, so
  // the shape is the contract and has to be pinned on both sides.
  assert.match(mlog, /saveDashboardLayout\(auth\.id, unwrap\(req\.body\)\.layout\)/)
  assert.match(client, /body: \["layout": inner\]/)

  assert.match(mlog, /saveDailyHistory\(auth\.id, text\(body\.date\), body\.values \|\| \{\}\)/)
  assert.match(client, /body: \["date": date, "values": values\]/)
})

test('goals are editable from the app, not just readable', () => {
  const goals = read('../api/goals.js')
  // Goals were session-only, which left the app able to show targets it could never
  // change. Same three credentials as the rest of the API now, in the same order.
  assert.match(goals, /const user = await userForSyncToken\(token\)\.catch\(\(\) => null\)/)
  assert.match(goals, /verifyAccessToken\(token, requiredScopes\)/)
  assert.match(goals, /req\.method === 'GET' \? \['fuel:read'\] : \['fuel:write'\]/)
})

test('the Coach only builds a plan on the explicit "New plan" action, and keeps just the newest one', () => {
  const store = read('../ios/Fuel/Sources/AppStore.swift')
  const coach = read('../ios/Fuel/Sources/CoachView.swift')
  // Logging food no longer awaits or triggers plan generation.
  assert.doesNotMatch(store, /await announceLogged/)
  assert.match(store, /func generateNewPlan\(\) async \{/)
  assert.match(store, /messages\.removeAll \{ \$0\.isPlan \}/)
  // The plan action is reachable from the UI as its own button, disabled while busy.
  assert.match(coach, /store\.generateNewPlan\(\)/)
  assert.match(coach, /\.disabled\(store\.coachThinking \|\| store\.dashboard == nil \|\| !ai\.isUsable\)/)
})

test('the Lifting, Explore, Places and Recipes tabs are all reachable from More', () => {
  const more = read('../ios/Fuel/Sources/MoreView.swift')
  for (const [view, label] of [
    ['LiftingView', 'Lifting'], ['ExploreView', 'Explore'],
    ['PlacesView', 'Places'], ['RecipesView', 'Recipes'],
  ]) {
    assert.match(more, new RegExp(`NavigationLink \\{ ${view}\\(\\) \\} label: \\{ Label\\("${label}"`),
      `${view} must be reachable from the More tab`)
  }
  // Editing preferences & context (the website's other More-menu item) is reachable too.
  assert.match(more, /showContext = true/)
  assert.match(more, /\.sheet\(isPresented: \$showContext\) \{ ContextEditorSheet\(\) \}/)
})

test('the resting-calories-floor goal is editable from the app, matching the website', () => {
  const client = read('../ios/Fuel/Sources/FuelClient.swift')
  const sheets = read('../ios/Fuel/Sources/EditSheets.swift')
  assert.match(client, /var restingCaloriesFloor: Double\?/)
  // Read on appear, written on save — a field that's only read would silently drop edits.
  assert.match(sheets, /"restingCaloriesFloor": text\(g\.restingCaloriesFloor\)/)
  assert.match(sheets, /next\.restingCaloriesFloor = Double\(values\["restingCaloriesFloor"\] \?\? ""\)/)
})

test('location capture is one fix per app open, never continuous background tracking', () => {
  const sampler = read('../ios/Fuel/Sources/LocationSampler.swift')
  // requestLocation() is a single fix-and-stop API; startUpdatingLocation() would
  // subscribe to a continuous stream, which this app never asks for.
  assert.match(sampler, /manager\.requestLocation\(\)/)
  assert.doesNotMatch(sampler, /startUpdatingLocation/)
  assert.doesNotMatch(sampler, /allowsBackgroundLocationUpdates/)
  // A denied or restricted prompt is respected, not retried.
  assert.match(sampler, /case \.denied, \.restricted:\s*\n\s*return/)
  // Off by default is not the goal here (the website defaults tracking on too), but
  // the toggle must exist and must gate the capture.
  assert.match(sampler, /var trackingEnabled: Bool/)
  // Never prompted before sign-in either — matches the website's own
  // useLocationCapture(session.authenticated) gate.
  assert.match(sampler, /guard AppStore\.shared\.isSignedIn, trackingEnabled else \{ return \}/)
  const places = read('../ios/Fuel/Sources/PlacesView.swift')
  assert.match(places, /LocationSampler\.shared\.trackingEnabled = value/)
})

test('logging a recipe estimates missing nutrition on-device, at most once, before giving up', () => {
  const store = read('../ios/Fuel/Sources/AppStore.swift')
  const match = store.match(/func logRecipe\(_ recipe: Recipe\) async -> Bool \{[\s\S]*?\n    \}/)
  assert.ok(match, 'logRecipe should be defined on AppStore')
  const body = match[0]
  // A single conditional retry, not a loop — an unbounded retry against a recipe that
  // can never be estimated would hang the log button forever.
  assert.doesNotMatch(body, /while |for /)
  assert.match(body, /OnDeviceAI\.shared\.estimateRecipeNutrition\(/)
  assert.match(body, /client\(\)\.saveRecipeNutrition\(recipeId: outcome\.recipeId \?\? id, nutrition: estimate\)/)
})

test('recipe nutrition — like every other AI task in the app — runs on device, never through Gemini', () => {
  const ai = read('../ios/Fuel/Sources/OnDeviceAI.swift')
  const client = read('../ios/Fuel/Sources/FuelClient.swift')
  const store = read('../ios/Fuel/Sources/AppStore.swift')
  assert.match(ai, /func estimateRecipeNutrition\(name: String, ingredients: \[String\], serving: String\?\)/)
  // FuelClient may only ever PUT an already-computed estimate (pure storage) for this
  // route — a POST here would be the website's Gemini-backed path, which must never
  // be reachable from the app.
  assert.doesNotMatch(client, /fuel_route=recipe-nutrition["'], method: "POST"/)
  assert.match(client, /fuel_route=recipe-nutrition["'], method: "PUT"/)
  assert.match(store, /OnDeviceAI\.shared\.estimateRecipeNutrition\(/)
  // The mlog.js PUT branch this calls must be pure storage too — no Gemini import used
  // to serve it.
  const mlog = read('../api/mlog.js')
  const put = mlog.match(/if \(req\.method === 'PUT'\) \{[\s\S]*?saveEstimatedNutrition\(recipeId,[\s\S]*?\n {6}\}/)
  assert.ok(put, 'handleRecipeNutrition should have a PUT branch that stores a client-supplied estimate')
  assert.doesNotMatch(put[0], /callGemini|estimateRecipeNutrition\(recipe\)/)
})

test('the recipe bank and places heatmap decode the server\'s actual response shape', () => {
  const client = read('../ios/Fuel/Sources/FuelClient.swift')
  const recipes = read('../api/_lib/recipes.js')
  const places = read('../api/_lib/places.js')
  // recipes.js nests nutrition under a `nutrition` object; a flat `calories` field on
  // Recipe (the app's original stub) would silently decode every recipe as empty.
  assert.match(recipes, /nutrition: \{/)
  assert.match(client, /var nutrition: RecipeNutrition\?/)
  // places.js returns bucketsPerDay/windowDays/daysCovered — pinning these catches a
  // renamed server field before it ships as "Places always shows zero check-ins."
  assert.match(places, /bucketsPerDay: BUCKETS_PER_DAY/)
  assert.match(client, /var bucketsPerDay: Int/)
  assert.match(client, /var daysCovered: Int/)
})

test('concurrent access-token requests join one refresh instead of racing', () => {
  // The server's refresh tokens are single-use. Two callers redeeming the same stale
  // one at once means one succeeds and the other is silently stranded on a dead token
  // until sign-out/sign-in — this pins the fix so it can't quietly regress.
  const signIn = read('../ios/Fuel/Sources/SignIn.swift')
  assert.match(signIn, /private var refreshTask: Task<Void, Never>\?/)
  assert.match(signIn, /if let refreshTask \{\s*\n\s*await refreshTask\.value/)
  assert.match(signIn, /refreshTask = task\b[\s\S]{0,80}await task\.value[\s\S]{0,40}refreshTask = nil/)
})

test('the app fetches its own health-sync token instead of reusing its OAuth token', () => {
  // /api/health/sync/v1 only ever accepted the dedicated sync-token model (see
  // health-sync.test.js) — sending it an OAuth access token 401s every time. The app
  // must mint/fetch a real sync token via /api/health/token and use that instead.
  const store = read('../ios/Fuel/Sources/AppStore.swift')
  assert.match(store, /\/api\/health\/token/)
  assert.match(store, /func ensureHealthSyncToken\(\) async -> String\?/)
  assert.match(store, /guard let token = await ensureHealthSyncToken\(\) else \{ return \}/)
  // client() must not stomp SyncStore's token with the OAuth token on every API call —
  // that was the actual bug: it silently overwrote a correct sync token if one was ever
  // set.
  const clientFn = store.match(/private func client\(\) async throws -> FuelClient \{[\s\S]*?\n {4}\}/)
  assert.ok(clientFn)
  assert.doesNotMatch(clientFn[0], /SyncStore/)
})

test('signing out clears the cached health-sync token, not just the OAuth session', () => {
  // Otherwise a second account signed into the same device would sync HealthKit data
  // under the first account's identity — the server trusts whichever account the sync
  // token was minted for, regardless of who is now signed in.
  const store = read('../ios/Fuel/Sources/AppStore.swift')
  const signOutFn = store.match(/func signOut\(\) \{[\s\S]*?\n {4}\}/)
  assert.ok(signOutFn)
  assert.match(signOutFn[0], /healthSyncToken = nil/)
  assert.match(signOutFn[0], /auth\.signOut\(\)/)
  const moreView = read('../ios/Fuel/Sources/MoreView.swift')
  assert.match(moreView, /store\.signOut\(\)/)
  assert.doesNotMatch(moreView, /store\.auth\.signOut\(\)/)
})

test('/api/health/token accepts an OAuth bearer as well as the website session cookie', () => {
  const token = read('../api/health/token.js')
  assert.match(token, /import \{ bearerToken, verifyAccessToken \} from '\.\.\/_lib\/mcp-auth\.js'/)
  assert.match(token, /verifyAccessToken\(bearerToken\(req\), \['fuel:read'\]\)/)
  // The data endpoint itself must stay exactly as locked-down as health-sync.test.js
  // pins — only the endpoint that mints a token gained a new way to authenticate.
  const sync = read('../api/_lib/health-sync.js')
  assert.doesNotMatch(sync, /verifyAccessToken/)
})

test('Compare lives inside Trends, not behind its own screen', () => {
  const compare = read('../ios/Fuel/Sources/CompareView.swift')
  // One place shows these numbers. A summary card in Trends plus a full page behind
  // More meant the same metrics rendered at two different levels of detail.
  assert.match(compare, /struct CompareSection: View/)
  assert.doesNotMatch(compare, /struct CompareView: View/)
  assert.doesNotMatch(compare, /struct CompareCards/)
  assert.match(read('../ios/Fuel/Sources/TrendsView.swift'), /CompareSection\(\)/)
  assert.doesNotMatch(read('../ios/Fuel/Sources/MoreView.swift'), /CompareView\(\)/)
})

test('the app does not send people to a website, a Shortcut or a companion app', () => {
  // Fuel is standalone: it reads HealthKit itself and is the whole product.
  for (const file of ['MoreView', 'FuelApp']) {
    const src = read(`../ios/Fuel/Sources/${file}.swift`)
    for (const [, copy] of src.matchAll(/Text\("([^"]+)"\)/g)) {
      assert.doesNotMatch(copy, /website|fuel\.rishib\.com|Shortcut|companion app/i,
        `${file}.swift shows "${copy}"`)
    }
  }
  assert.doesNotMatch(read('../ios/Fuel/Sources/MoreView.swift'), /Open Fuel on the web/)
})

test('the captured photo is frozen on screen while it is being read', () => {
  const cam = read('../ios/Fuel/Sources/CameraLogView.swift')
  // Live video behind a spinner tells you nothing about what was sent.
  assert.match(cam, /@State private var frozen: Data\?/)
  assert.match(cam, /if let frozen, let image = UIImage\(data: frozen\)/)
  // Both shutters freeze: the straight-to-log one and the add-context one.
  assert.equal((cam.match(/frozen = data/g) || []).length, 2)
  // And it thaws again, whichever way the capture ends.
  assert.match(cam, /frozen = nil/)
  // The context sheet shows the shot the note is about.
  assert.match(cam, /if let pendingPhoto, let image = UIImage\(data: pendingPhoto\)/)
  assert.match(cam, /Button\("Cancel"\)/)
})

test('manual entry is fully manual: every macro editable, no model required', () => {
  const cam = read('../ios/Fuel/Sources/CameraLogView.swift')
  assert.match(cam, /Label\("Manual", systemImage/)
  assert.doesNotMatch(cam, /Label\("Type", systemImage/)
  assert.match(cam, /\.navigationTitle\("Manual Entry"\)/)
  assert.doesNotMatch(cam, /Log by hand/)
  for (const f of ['Calories', 'Protein', 'Carbs', 'Fat', 'Fiber']) {
    assert.match(cam, new RegExp(`field\\("${f}"`), `${f} must be hand-editable`)
  }
  // A blank field means unknown. Sending 0 would log a real, wrong zero.
  assert.match(cam, /n\.calories == nil && n\.protein == nil/)
  // The picker is now the whole log library, not just the built-in food table.
  assert.match(cam, /FoodLibraryView/)
})

test('the common-foods table carries published per-serving values', () => {
  const foods = read('../ios/Fuel/Sources/CommonFoods.swift')
  const rows = [...foods.matchAll(/CommonFood\(name: "([^"]+)", portion: "([^"]+)"/g)]
  assert.ok(rows.length >= 40, `expected a real table, got ${rows.length} foods`)
  // The things people actually reach for, named in the request.
  for (const name of ['Ice cream, vanilla', 'Pizza, cheese', 'Banana', 'Apple']) {
    assert.ok(rows.some(r => r[1] === name), `${name} should be in the table`)
  }
  // Every row states its serving size — a calorie count with no portion is unusable.
  for (const [, name, portion] of rows) {
    assert.match(portion, /\d/, `${name} needs a quantified portion`)
  }
  // Every group in the picker's section order actually has foods in it.
  const groups = foods.match(/static let groups = \[([^\]]+)\]/)[1]
    .split(',').map(s => s.trim().replace(/"/g, ''))
  for (const g of groups) {
    assert.ok(foods.includes(`group: "${g}")`), `group ${g} is empty`)
  }
  assert.match(foods, /static func matches\(_ query: String/)
})

test('a vital that barely moves cannot manufacture a huge z-score', () => {
  // Reported symptom: cardio recovery read 44 against a 44 baseline and came back
  // "Low ↓ · z 8.4", which alone dragged the day to 1/10. The cause is MAD-derived
  // sigma collapsing toward zero when a vital reads the same number most days, so a
  // difference below the sensor's precision divides out to a huge z.
  const swift = read('../ios/Fuel/Sources/VitalsSignal.swift')
  assert.match(swift, /var minimumMeaningfulSpread: Double/)
  assert.match(swift, /sigma = max\(sigma, key\.minimumMeaningfulSpread\)/)
  // Every vital needs a floor; a missing case would silently keep the old behavior.
  for (const key of ['restingHeartRate', 'hrv', 'respiratoryRate', 'bloodOxygen',
                     'walkingHeartRateAverage', 'cardioRecovery']) {
    assert.match(swift, new RegExp(`case \\.${key}: return \\d`), `${key} needs a spread floor`)
  }
  // The website runs the same statistic and had the same bug.
  const web = read('../src/App.tsx')
  assert.match(web, /minSpread:number/)
  assert.match(web, /sigma=Math\.max\(sigma,def\.minSpread\)/)
  for (const key of ['restingHeartRate', 'hrv', 'cardioRecovery']) {
    assert.match(web, new RegExp(`key:'${key}'[^}]*minSpread:`), `${key} needs a spread floor`)
  }
})

test('the vitals banner opens a page charting every vital against its history', () => {
  const detail = read('../ios/Fuel/Sources/VitalsDetailView.swift')
  assert.match(detail, /struct VitalsDetailView: View/)
  // Every vital the signal evaluates gets a chart, not just the flagged ones.
  assert.match(detail, /ForEach\(signal\.items, id: \\\.key\)/)
  // The band drawn is the one the score actually uses, floor included — otherwise the
  // picture and the verdict could disagree.
  assert.match(detail, /minimumMeaningfulSpread/)
  assert.match(detail, /RuleMark\(y: \.value\("Usual", center\)\)/)
  const bar = read('../ios/Fuel/Sources/VitalsSignal.swift')
  assert.match(bar, /See all vitals and their trends/)
  assert.match(bar, /VitalsDetailView\(trends: trends, summary: summary\)/)
})

test('the widgets read a shared snapshot rather than the network', () => {
  // A widget extension cannot sign in, call the API, or read HealthKit for the app, so
  // the only honest design is: app writes, widget reads.
  const shared = read('../ios/Fuel/Sources/WidgetShared.swift')
  assert.match(shared, /static let appGroup = "group\.com\.labloggercompany\.fuel"/)
  assert.match(shared, /containerURL\(forSecurityApplicationGroupIdentifier: appGroup\)/)
  for (const target of ['../ios/Fuel/Resources/Fuel.entitlements',
                        '../ios/FuelWidgets/FuelWidgets.entitlements']) {
    assert.match(read(target), /group\.com\.labloggercompany\.fuel/,
      `${target} must join the App Group or the snapshot is unreadable`)
  }
  // Nothing in the extension talks to the server or Health.
  for (const file of ['WidgetPieces', 'EnergyWidgets', 'OtherWidgets', 'FuelWidgetBundle']) {
    const src = read(`../ios/FuelWidgets/Sources/${file}.swift`)
    assert.doesNotMatch(src, /URLSession|HKHealthStore|FuelClient/,
      `${file}.swift must not reach past the snapshot`)
  }
  // The app republishes on every load and on every palette change.
  assert.match(read('../ios/Fuel/Sources/AppStore.swift'), /WidgetPublisher\.publish\(dashboard:/)
  assert.match(read('../ios/Fuel/Sources/DashboardTheme.swift'), /WidgetPublisher\.republishPalette\(\)/)
})

test('every widget is themed by the user palette, never a fixed color', () => {
  const bundle = read('../ios/FuelWidgets/Sources/FuelWidgetBundle.swift')
  const kinds = [...bundle.matchAll(/kind: "([^"]+)"/g)].map(m => m[1])
  assert.ok(kinds.length >= 16, `expected a full gallery, got ${kinds.length} widgets`)
  assert.equal(new Set(kinds).size, kinds.length, 'widget kinds must be unique')
  // Each declared widget is listed in the bundle, or it never appears in the gallery.
  for (const [, name] of bundle.matchAll(/struct (\w+Widget): Widget/g)) {
    assert.match(bundle, new RegExp(`^\\s+${name}\\(\\)$`, 'm'), `${name} is missing from the bundle`)
  }
  // Colors come from the snapshot's palette. Color.red survives only as the vitals
  // alert, which means "unusual" rather than a decorative choice.
  for (const file of ['WidgetPieces', 'EnergyWidgets', 'OtherWidgets']) {
    const src = read(`../ios/FuelWidgets/Sources/${file}.swift`)
    assert.doesNotMatch(src, /Color\(hex:|Color\.blue|Color\.green|\.orange\b/,
      `${file}.swift should read the palette, not a fixed hue`)
  }
})

test('a logged meal ends on the dashboard, at the row it created', () => {
  const store = read('../ios/Fuel/Sources/AppStore.swift')
  assert.match(store, /var highlightedEntryID: String\?/)
  assert.match(store, /private func highlightNewest/)
  // Every logging path points at the result: manual, camera, saved meal, plus the
  // helper itself.
  assert.equal((store.match(/highlightNewest\(/g) || []).length, 4)
  const app = read('../ios/Fuel/Sources/FuelApp.swift')
  assert.match(app, /onChange\(of: store\.jumpToToday\)/)
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  assert.match(today, /ScrollViewReader \{ scroller in/)
  assert.match(today, /scroller\.scrollTo\(id, anchor: \.center\)/)
  assert.match(today, /\.id\(entry\.id\)/)
  // The flash clears itself; a highlight that never fades is just a selected row.
  assert.match(today, /store\.highlightedEntryID = nil/)
})

test('tapping a widget opens the tab it came from', () => {
  const bundle = read('../ios/FuelWidgets/Sources/FuelWidgetBundle.swift')
  assert.match(bundle, /URL\(string: "fuel:\/\/\\\(destination\)"\)/)
  const app = read('../ios/Fuel/Sources/FuelApp.swift')
  assert.match(app, /\.onOpenURL/)
  for (const tab of ['today', 'trends', 'log', 'coach', 'more']) {
    assert.match(app, new RegExp(`case "${tab}": tab = \\.${tab}`), `fuel://${tab} must route`)
  }
})

test('the vitals charts plot dates, not date strings', () => {
  const src = read('../ios/Fuel/Sources/VitalsDetailView.swift')
  // A String x gave Charts a categorical axis: one label per day (an unreadable smear at
  // 30 days), points placed by array order rather than by date, and a range band that
  // covered one category instead of spanning the plot.
  assert.match(src, /x: \.value\("Day", point\.date, unit: \.day\)/)
  assert.doesNotMatch(src, /points: \[\(date: String/)
  // Sorted and de-duplicated: a line connects points in array order, so one repeated or
  // out-of-order day draws a stray segment back across the whole chart.
  assert.match(src, /var byDay: \[Date: Double\] = \[:\]/)
  assert.match(src, /byDay\.sorted \{ \$0\.key < \$1\.key \}/)
  // No smoothing — it would invent readings between days that were never measured.
  assert.doesNotMatch(src, /interpolationMethod/)
})

test('vitals axis ticks thin out as you zoom out', () => {
  const src = read('../ios/Fuel/Sources/VitalsDetailView.swift')
  assert.match(src, /static func ticks\(forVisibleDays days: Double\)/)
  const cases = [...src.matchAll(/case \.\.<(\d+): return \(\.(\w+), (\d+)\)/g)]
    .map(m => ({ upTo: Number(m[1]), unit: m[2], count: Number(m[3]) }))
  assert.ok(cases.length >= 4, 'expected several zoom bands')
  // Thresholds ascend, and each band is coarser than the one before it — otherwise
  // zooming out could somehow produce denser labels.
  const rank = { day: 1, weekOfYear: 7, month: 30 }
  let prevUpTo = 0, prevSpacing = 0
  for (const c of cases) {
    assert.ok(c.upTo > prevUpTo, `thresholds must ascend, ${c.upTo} follows ${prevUpTo}`)
    const spacing = rank[c.unit] * c.count
    assert.ok(spacing > prevSpacing, `${c.unit} x${c.count} is not coarser than the previous band`)
    prevUpTo = c.upTo; prevSpacing = spacing
  }
  // Zoomed all the way in, a tick per day.
  assert.equal(cases[0].unit, 'day')
  assert.equal(cases[0].count, 1)
  // And the chart is actually zoomable, or the density would never change. Zoom is
  // pinch-only — no chart-level drag-to-scroll, which would race the page's own
  // vertical ScrollView on a diagonal drag.
  assert.match(src, /MagnifyGesture\(\)/)
  assert.doesNotMatch(src, /\.chartScrollableAxes/)
  assert.match(src, /\.chartXScale\(domain: visibleRange\)/)
})

test('the widget scheme names a widget kind, so Run works on it', () => {
  // Running a widget extension asks SpringBoard to show ONE widget, and it refuses
  // without _XCWidgetKind: "SBAvocadoDebuggingControllerErrorDomain Code=2".
  const spec = read('../ios/Fuel/project.yml')
  assert.match(spec, /_XCWidgetKind: (\w+)/)
  const kind = spec.match(/_XCWidgetKind: (\w+)/)[1]
  // It has to be a kind the bundle actually registers, or Run fails the same way.
  assert.match(read('../ios/FuelWidgets/Sources/FuelWidgetBundle.swift'),
    new RegExp(`kind: "${kind}"`), `${kind} is not a registered widget kind`)
  // Both schemes are shared, so the generated project always exposes them.
  const scheme = read('../ios/Fuel/Fuel.xcodeproj/xcshareddata/xcschemes/FuelWidgets.xcscheme')
  assert.match(scheme, /key = "_XCWidgetKind"/)
  assert.match(scheme, new RegExp(`value = "${kind}"`))
})

test('saved meals are the user\'s own, kept separate from the shared recipe bank', () => {
  const meals = read('../api/_lib/meals.js')
  assert.match(meals, /CREATE TABLE IF NOT EXISTS user_meals/)
  // Every query is scoped to one user — a saved meal is private, unlike recipes.
  for (const [, query] of meals.matchAll(/(FROM user_meals[\s\S]{0,200}?)(?:`|LIMIT)/g)) {
    assert.match(query, /user_id = \$\{userId\}/, `unscoped user_meals query: ${query.trim()}`)
  }
  // Items are stored, not a single summed row, so re-logging reproduces the entries.
  assert.match(meals, /items jsonb NOT NULL/)
  assert.match(meals, /export async function createMealFromEntries/)
  // Nutrition for an entry-derived meal is read server-side, never taken from the body.
  assert.match(meals, /SELECT description, portion, meal, calories_kcal/)
})

test('logging a saved meal cannot be forged by the client', () => {
  const mlog = read('../api/mlog.js')
  const handler = mlog.slice(mlog.indexOf('async function handleMeals'), mlog.indexOf('async function handleFoodHistory'))
  // The stored meal supplies the nutrition; the request only names which meal.
  assert.match(handler, /const meal = await getMeal\(auth\.id, body\.id\)/)
  assert.match(handler, /\$\{number\(item\.calories\)\}/)
  assert.doesNotMatch(handler, /number\(body\.calories/)
})

test('a logged meal can be tagged with where it was eaten', () => {
  const mlog = read('../api/mlog.js')
  // Resolved server-side into one of the user's places: the entry stores a place, not
  // a trail of raw coordinates.
  assert.match(mlog, /async function placeFromRequest/)
  assert.match(mlog, /recordLocation\(userId, \{[\s\S]*?\}, \{ force: true \}\)/)
  // A location failure must never fail the log.
  const fn = mlog.slice(mlog.indexOf('async function placeFromRequest'))
  assert.match(fn.slice(0, 900), /catch \(error\) \{[\s\S]*?return null/)
  // The dashboard surfaces the place name, left-joined so untagged entries survive.
  const dash = read('../api/_lib/neon-dashboard.js')
  assert.match(dash, /LEFT JOIN user_places/)
  assert.match(dash, /place: row\.place_label \|\| null/)
  // The client sends a fix only when the user already allowed location.
  const sampler = read('../ios/Fuel/Sources/LocationSampler.swift')
  assert.match(sampler, /func fixForLogging\(\) async -> MealFix\?/)
  assert.match(sampler, /guard trackingEnabled else \{ return nil \}/)
  assert.match(sampler, /status == \.authorizedWhenInUse \|\| status == \.authorizedAlways/)
})

test('the log library is three tabs — history, foods, and my meals — not one long list', () => {
  const lib = read('../ios/Fuel/Sources/FoodLibraryView.swift')
  assert.match(lib, /private enum LibraryTab: String, CaseIterable \{/)
  assert.match(lib, /case history = "History"/)
  assert.match(lib, /case foods = "Foods"/)
  assert.match(lib, /case meals = "My meals"/)
  assert.match(lib, /\.pickerStyle\(\.segmented\)/)
  assert.match(lib, /case \.history: historyTab/)
  assert.match(lib, /case \.foods: foodsTab/)
  assert.match(lib, /case \.meals: mealsTab/)
  assert.match(lib, /CommonFoods\.groups/)
  // One search box, contextual to whichever tab is active.
  assert.match(lib, /\.searchable\(text: \$search, prompt: searchPrompt\)/)
  for (const shelf of ['meals', 'history', 'common']) {
    assert.match(lib, new RegExp(`private var ${shelf}: \\[`), `${shelf} shelf must filter on the query`)
  }
  // History is capped to a recent handful while browsing — a bottomless "everything
  // you've ever logged" list defeats the point of "what did I just eat" — but a search
  // lifts the cap so a real lookup isn't truncated.
  assert.match(lib, /private static let historyBrowseLimit = 20/)
  assert.match(lib, /query\.isEmpty \? Array\(matches\.prefix\(Self\.historyBrowseLimit\)\) : matches/)

  // And the old common-foods-only picker is gone rather than left as a second door.
  const camera = read('../ios/Fuel/Sources/CameraLogView.swift')
  assert.doesNotMatch(camera, /CommonFoodPicker/)
  // The library entry point is its own full-width card, not a small text link buried
  // inside the manual-entry form.
  assert.match(camera, /private var libraryCard: some View/)
  assert.match(camera, /Text\("Log from my library"\)\.font\(\.system\(size: 16, weight: \.semibold\)\)/)
})

test('notifications are opt-in, Coach-only, and never fire in the foreground', () => {
  const notif = read('../ios/Fuel/Sources/Notifications.swift')
  // Off until asked for: permission requested on first launch gets declined forever.
  // (Replies/reactions/weekly default true, but only ever fire once something else —
  // the master switch, or a reply actually being awaited — already applies.)
  assert.match(notif, /proactiveEnabled = d\.bool\(forKey: Self\.proactiveKey\)/)
  assert.match(notif, /guard UIApplication\.shared\.applicationState != \.active else \{ return \}/)
  // A workout is reacted to once, not on every sync that re-reads the same day.
  assert.match(notif, /func isNewWorkout/)
  const store = read('../ios/Fuel/Sources/AppStore.swift')
  assert.match(store, /Notifications\.shared\.markWorkoutSeen\(key\)/)
  // Marked before generating, so a failure cannot re-announce the same workout.
  const react = store.slice(store.indexOf('private func reactToNewWorkouts'))
  assert.ok(react.indexOf('markWorkoutSeen') < react.indexOf('OnDeviceAI.shared.ask'),
    'a workout must be marked seen before the reply is generated')
  // Tapping the notification lands in the chat.
  assert.match(read('../ios/Fuel/Sources/FuelApp.swift'), /notifications\.openCoachRequested/)
})

test('a coach answer survives leaving the app', () => {
  const store = read('../ios/Fuel/Sources/AppStore.swift')
  const ask = store.slice(store.indexOf('func askCoach'), store.indexOf('private func announceIfAway'))
  // Without a background task iOS suspends the app mid-answer and the reply is lost.
  assert.match(ask, /beginBackgroundTask\(withName: "coach reply"\)/)
  assert.match(ask, /endBackgroundTask\(task\)/)
  assert.match(ask, /await announceIfAway/)
})

test('workouts come from real HKWorkout data, not inferred from daily step/distance totals', () => {
  // The reported bug: the dashboard treated any day with nonzero walking distance as
  // "a workout", and since that distance climbs all day, every sync looked like a new
  // one — the Coach congratulated a walk to the kitchen, repeatedly.
  const engine = read('../ios/HealthLogger/Sources/SyncEngine.swift')
  assert.match(engine, /private func recentWorkouts\(days: Int\) async throws -> \[WorkoutSample\]/)
  assert.match(engine, /sampleType: \.workoutType\(\)/)
  assert.match(engine, /payload\.tables\.workoutSamples = try await recentWorkouts\(days: days\)/)

  const dash = read('../api/_lib/neon-dashboard.js')
  assert.doesNotMatch(dash, /function healthWorkouts/)
  assert.match(dash, /FROM hk_workouts/)
  assert.match(dash, /workouts: \(workoutsByDate\.get\(today\) \|\| \[\]\)\.map\(normalizeWorkout\)/)
  // Distance goes to exactly one field depending on activity, never both — a swim's
  // meters becoming both "1.2 mi" and "1312 yd" on the same row would be double-counted.
  assert.match(dash, /isSwim \|\| distanceM == null \? null : distanceM \/ 1609\.344/)
  assert.match(dash, /isSwim && distanceM != null \? distanceM \* 1\.09361 : null/)

  // Dedup uses the workout's own stable id (the HealthKit UUID), not fields that
  // change as the day goes on.
  const client = read('../ios/Fuel/Sources/FuelClient.swift')
  assert.match(client, /var id: String \{ workoutId \?\? /)
  const store = read('../ios/Fuel/Sources/AppStore.swift')
  const react = store.slice(store.indexOf('private func reactToNewWorkouts'))
  assert.match(react, /"\\\(summary\.date\)\|\\\(workout\.id\)"/)
})

test('a Lock Screen control opens the app via a universal link, not a custom scheme', () => {
  // Verified against Apple's own forums: OpenURLIntent from a Control silently does
  // nothing for a custom fuel:// scheme — only a universal link works there, unlike the
  // Home Screen widgets' widgetURL, which is a different mechanism and handles fuel://
  // fine (left untouched).
  const intents = read('../ios/FuelWidgets/Sources/FuelControlIntents.swift')
  assert.match(intents, /https:\/\/fuel\.rishib\.com\/open\?dest=log/)
  assert.match(intents, /https:\/\/fuel\.rishib\.com\/open\?dest=today/)
  assert.doesNotMatch(intents, /fuel:\/\/log/)

  // The intent types must be compiled into the app target too, not only the extension
  // — reported as required for the app to reliably foreground from a Control.
  const spec = read('../ios/Fuel/project.yml')
  assert.match(spec, /path: \.\.\/FuelWidgets\/Sources\/FuelControlIntents\.swift/)
  assert.match(spec, /com\.apple\.developer\.associated-domains: \[applinks:fuel\.rishib\.com\]/)

  // The app must actually be able to answer the AASA lookup at the well-known path.
  assert.match(read('../vercel.json'), /"\/\.well-known\/apple-app-site-association"/)
  const mlog = read('../api/mlog.js')
  assert.match(mlog, /function handleAppleAppSiteAssociation/)
  assert.match(mlog, /9VVDB6UALA\.com\.labloggercompany\.fuel/)

  // And the app must read both shapes of the deep link once opened.
  const app = read('../ios/Fuel/Sources/FuelApp.swift')
  assert.match(app, /url\.scheme == "fuel"/)
  assert.match(app, /url\.host == "fuel\.rishib\.com", url\.path == "\/open"/)
})

test('swiping a food entry reveals three real buttons, not a menu behind a menu', () => {
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  const rowStart = today.indexOf('struct FoodEntryRow: View')
  const rowEnd = today.indexOf('\n/// The website\'s NUTRIENT_DISPLAY')
  const row = today.slice(rowStart, rowEnd > rowStart ? rowEnd : undefined)
  assert.match(row, /HorizontalPan \{ translation in/)
  // Each action is its own rectangle in the revealed strip — no Menu anywhere in the
  // row, which would mean a tap-to-reveal list sitting behind the swipe instead of
  // being replaced by it.
  assert.doesNotMatch(row, /\bMenu\s*\{/)
  assert.doesNotMatch(row, /Image\(systemName: "ellipsis"\)/)
  assert.match(today, /actionButton\("Edit", "pencil"/)
  // Add/Added is now two-state — see the bookmark test below for which is which.
  assert.match(today, /actionButton\("Add(ed)?", "bookmark(\.fill)?"/)
  assert.match(today, /actionButton\("Delete", "trash", \.red\)/)
  assert.match(today, /store\.saveMeal\(named: entry\.food, fromEntryIDs: \[entry\.id\]\)/)
  // The row's background matches the panel it sits in, not the separate "surface" tone
  // — that mismatch was what made every row read as its own smaller card.
  assert.match(today, /\.background\(Palette\.panel\(scheme\)\)/)
  assert.doesNotMatch(today, /row\s*\n\s*\.background\(Palette\.surface/)
  // The row keeps its scroll-to id, or the "jump to what I just logged" feature breaks.
  assert.match(today, /FoodEntryRow\(entry: entry,[\s\S]{0,400}\n\s*\.id\(entry\.id\)/)
  // The old always-visible Edit/Delete button pair is gone, not left as a duplicate.
  assert.doesNotMatch(today, /Label\("Delete", systemImage: "trash"\)\.font\(\.caption\)/)
})

test('building a meal suggests your own recent history ahead of the common-foods table', () => {
  const editor = read('../ios/Fuel/Sources/FoodLibraryView.swift')
  const body = editor.slice(editor.indexOf('struct MealItemEditor'))
  assert.match(body, /store\.foodHistory\s*\n?\s*\.filter/)
  const historyPos = body.indexOf('ForEach(historyMatches)')
  const commonPos = body.indexOf('ForEach(commonMatches)')
  assert.ok(historyPos > 0 && historyPos < commonPos, 'history suggestions must render before common foods')
})

test('charts no longer offer drag-to-scroll, only pinch — the outer page stays vertical-only', () => {
  // chartScrollableAxes sat inside a vertical ScrollView; on a diagonal drag both the
  // chart's own horizontal scroll and the page's vertical scroll could fire together,
  // which read as the whole page being freely draggable rather than a chart with its
  // own scroll. Pinch alone can't cause that ambiguity — it needs a second finger a
  // one-finger page-scroll never provides.
  for (const file of ['TrendsView', 'VitalsDetailView', 'TodayView']) {
    const src = read(`../ios/Fuel/Sources/${file}.swift`)
    assert.doesNotMatch(src, /\.chartScrollableAxes\(/, `${file}.swift still offers drag-to-scroll`)
    assert.doesNotMatch(src, /\.chartScrollPosition\(/, `${file}.swift still offers drag-to-scroll`)
  }
  // Each chart still zooms — the window just resizes around a fixed trailing anchor
  // instead of scrolling to an arbitrary position.
  assert.match(read('../ios/Fuel/Sources/TrendsView.swift'), /MagnificationGesture\(\)/)
  assert.match(read('../ios/Fuel/Sources/VitalsDetailView.swift'), /MagnifyGesture\(\)/)
  assert.match(read('../ios/Fuel/Sources/TodayView.swift'), /MagnificationGesture\(\)/)
})

test('the food-row swipe is driven by one committed state, not a GestureState racing it', () => {
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  const row = today.slice(today.indexOf('struct FoodEntryRow: View'), today.indexOf('\n/// The website\'s NUTRIENT_DISPLAY'))
  // The old @GestureState + separate committed offset combination was the actual bug:
  // GestureState snaps to zero un-animated the instant a drag ends, the same beat
  // onEnded's withAnimation was setting the committed offset, so the row visibly
  // jumped to zero for a frame before animating to where it was headed.
  assert.doesNotMatch(row, /@GestureState private var offset/)
  assert.match(row, /offset = max\(-revealWidth, min\(0, dragStartOffset \+ translation\)\)/)
  // A flick still opens or closes past the halfway point, now from the pan's own
  // release velocity rather than DragGesture's predictedEndTranslation.
  assert.match(row, /let settled = dragStartOffset \+ predicted/)
  assert.match(read('../ios/Fuel/Sources/HorizontalPan.swift'), /translation \+ velocity \* 0\.25/)
})

test('the food-consumed selection bar is Select-first and closes when you tap elsewhere', () => {
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  assert.match(today, /Label\("Select", systemImage: "checkmark\.circle"\)/)
  // Once something's picked, Select's slot becomes Save-as-meal plus a bulk Delete —
  // not a fixed row of buttons some of which sit disabled.
  assert.match(today, /Button\("Save as meal"\)/)
  assert.match(today, /Label\("Delete", systemImage: "trash"\)\.font\(\.system\(size: 13\)\)/)
  assert.match(today, /func exitSelection\(\)/)
  // The food card absorbs its own taps so they can't reach the outside-the-card
  // catcher and prematurely end selection.
  assert.match(today, /onTapGesture \{\}/)
  assert.match(today, /if selecting \{ exitSelection\(\) \}/)
  assert.match(read('../ios/Fuel/Sources/AppStore.swift'), /func deleteFoods\(_ ids: \[String\]\) async/)
})

test('the Today dashboard pages between days by swiping, without fighting the page scroll', () => {
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  assert.match(today, /store\.page\(goingBack \? 1 : -1\)/)
  // The same disambiguation the row swipe uses — mostly-horizontal, a real minimum
  // distance — is what lets this live inside a vertical ScrollView at all.
  assert.match(today, /DragGesture\(minimumDistance: 40\)/)
  assert.match(today, /abs\(value\.translation\.width\) > abs\(value\.translation\.height\) \* 1\.5/)
  assert.match(today, /private var pageTitle: String/)

  const store = read('../ios/Fuel/Sources/AppStore.swift')
  assert.match(store, /var dayOffset = 0/)
  assert.match(store, /func page\(_ direction: Int\)/)
  assert.match(store, /func loadViewingDay\(\) async/)
  // Today's own entries never trigger a fetch — they're already on the dashboard
  // payload — only a day actually being paged back to does.
  assert.match(store, /guard !isViewingToday, let date = viewingDate, dayDetailCache\[date\] == nil else \{\s*\n\s*prefetchNextDay\(\)/)

  // Server side: a day's detail is fetched separately from its summary, which trends
  // already carries — no duplicated per-day dashboard computation.
  const dash = read('../api/_lib/neon-dashboard.js')
  assert.match(dash, /export async function getDayDetail/)
  const mlog = read('../api/mlog.js')
  assert.match(mlog, /integrationRoute === 'day-detail'/)
  assert.match(mlog, /ISO_DATE_RE\.test\(date\)/)
})

test('workouts show an icon, duration, time range and active calories', () => {
  const client = read('../ios/Fuel/Sources/FuelClient.swift')
  const workout = client.slice(client.indexOf('struct Workout: Decodable'), client.indexOf('struct Supplement'))
  for (const field of ['durationMinutes', 'activeCalories', 'endTime', 'activityKey']) {
    assert.match(workout, new RegExp(`var ${field}`), `Workout must decode ${field}`)
  }
  assert.match(workout, /var icon: String/)
  // A handful of Apple's own Fitness-app glyphs, not just a single generic fallback.
  for (const icon of ['figure.run', 'figure.pool.swim', 'figure.strengthtraining.traditional', 'figure.mixed.cardio']) {
    assert.match(workout, new RegExp(icon.replace(/\./g, '\\.')))
  }
  const dash = read('../api/_lib/neon-dashboard.js')
  assert.match(dash, /endTime: new Intl\.DateTimeFormat/)
  assert.match(dash, /activityKey: activity/)
})

test('"Learn from me" appends observations mined from logged data, never replacing anything', () => {
  const sheet = read('../ios/Fuel/Sources/EditSheets.swift')
  assert.match(sheet, /Text\(learning \? "Looking at what you've logged…" : "Learn from me"\)/)
  assert.match(sheet, /func appendLearned/)
  // Appending means the existing text is always a prefix of the result.
  assert.match(sheet, /text = text\.isEmpty \? block : text \+ "\\n\\n" \+ block/)
  assert.doesNotMatch(sheet, /text = block\b/)

  const store = read('../ios/Fuel/Sources/AppStore.swift')
  assert.match(store, /func learnFromMe\(\) async throws -> \[String\]/)
  // Built from mined associations (a food clustering on a weekday, a workout's effect
  // on next-night sleep/HRV, a habit's usual time of day), not flat averages — those
  // read as "you eat 2400 kcal on average," which isn't an insight.
  assert.match(store, /client\(\)\.learningSignals\(\)/)
  assert.match(store, /signals\.foodWeekdayPatterns/)
  assert.match(store, /signals\.workoutAftereffects/)
  assert.match(store, /signals\.workoutTiming/)
  assert.match(store, /signals\.activeWeekdays/)
  assert.match(store, /client\(\)\.places\(days: 30\)/)

  for (const file of ['OnDeviceAI', 'RemoteAI']) {
    const src = read(`../ios/Fuel/Sources/${file}.swift`)
    assert.match(src, /func learnFromData/)
    // The candidates are real, computed numbers — the model's job is to pick and
    // phrase, not to invent or re-derive them.
    assert.match(src, /every number in them is real and computed, not something you need to/)
  }

  // The server mines these deterministically (plain aggregation over real rows), not
  // via AI — see api/_lib/learning.js.
  const learning = read('../api/_lib/learning.js')
  assert.match(learning, /export async function getLearningSignals/)
  assert.match(learning, /function foodWeekdayPatterns/)
  assert.match(learning, /function workoutAftereffects/)
  assert.match(learning, /function workoutTiming/)
  assert.match(learning, /function activeWeekdayPattern/)
  const mlog = read('../api/mlog.js')
  assert.match(mlog, /integrationRoute === 'learning-signals'/)
})

test('notification kinds are independent: replies always on, outreach behind its own switch', () => {
  const notif = read('../ios/Fuel/Sources/Notifications.swift')
  assert.match(notif, /var proactiveEnabled: Bool/)
  assert.match(notif, /var repliesEnabled: Bool/)
  assert.match(notif, /var workoutReactionsEnabled: Bool/)
  assert.match(notif, /var weeklyRundownEnabled: Bool/)
  // Replies default on and are never gated by the proactive switch.
  assert.match(notif, /repliesEnabled = d\.object\(forKey: Self\.repliesKey\) == nil \? true/)
  assert.match(notif, /func postReply\(_ body: String\) async \{\s*guard repliesEnabled else \{ return \}/)
  // Outreach needs both its own toggle and the master switch.
  assert.match(notif, /var canReactToWorkouts: Bool \{ proactiveEnabled && workoutReactionsEnabled \}/)
  assert.match(notif, /var canSendWeeklyRundown: Bool \{ proactiveEnabled && weeklyRundownEnabled \}/)
  assert.match(notif, /func postProactive\(_ body: String, title: String\) async \{\s*guard proactiveEnabled else \{ return \}/)

  const store = read('../ios/Fuel/Sources/AppStore.swift')
  assert.match(store, /Notifications\.shared\.postReply\(text\)/)
  assert.match(store, /guard Notifications\.shared\.canReactToWorkouts, OnDeviceAI\.shared\.isUsable else \{ return \}/)
  assert.match(store, /Notifications\.shared\.postProactive\(text, title: "Nice session"\)/)
  assert.doesNotMatch(store, /Notifications\.shared\.enabled\b/)
  assert.doesNotMatch(store, /postCoachMessage/)

  // A dedicated settings screen with the four toggles, reachable from More.
  const more = read('../ios/Fuel/Sources/MoreView.swift')
  assert.match(more, /struct NotificationSettingsView: View/)
  assert.match(more, /NavigationLink \{ NotificationSettingsView\(\) \}/)
  assert.match(more, /Toggle\("Coach replies", isOn: \$notifications\.repliesEnabled\)/)
  assert.match(more, /Toggle\("Let coach message me", isOn: \$notifications\.proactiveEnabled\)/)
  assert.match(more, /Toggle\("Workout reactions", isOn: \$notifications\.workoutReactionsEnabled\)/)
  assert.match(more, /Toggle\("Weekly rundown", isOn: \$notifications\.weeklyRundownEnabled\)/)
})

test('the weekly rundown is opportunistic, Saturday-morning-gated, and once per week', () => {
  const notif = read('../ios/Fuel/Sources/Notifications.swift')
  assert.match(notif, /func isDueForWeeklyRundown/)
  assert.match(notif, /weekday == 7/) // Saturday
  assert.match(notif, /func markWeeklyRundownSent/)

  const store = read('../ios/Fuel/Sources/AppStore.swift')
  assert.match(store, /func sendWeeklyRundownIfDue\(\) async/)
  assert.match(store, /await sendWeeklyRundownIfDue\(\)/)
  // Marked sent before generating, so a slow or failed generation can't leave the week
  // eligible to fire again on the very next sync.
  const fn = store.slice(store.indexOf('private func sendWeeklyRundownIfDue'))
  assert.ok(fn.indexOf('markWeeklyRundownSent') < fn.indexOf('OnDeviceAI.shared.ask'),
    'the week must be marked sent before the rundown is generated')
  assert.match(fn.slice(0, 2000), /Notifications\.shared\.canSendWeeklyRundown/)
})

test('day-paging carries the outgoing day off-screen and slides the new one in', () => {
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  // Live-tracks the finger, then either snaps back or animates fully off-screen before
  // the data swaps — the old version just changed the data under a static view, which
  // read as an abrupt cut rather than a page turning.
  assert.match(today, /@State private var pageDragOffset: CGFloat = 0/)
  assert.match(today, /\.offset\(x: pageDragOffset\)/)
  assert.match(today, /func snapBack\(\)/)
  assert.match(today, /func slidePage\(goingBack: Bool\)/)
  const slide = today.slice(today.indexOf('private func slidePage'))
  assert.match(slide.slice(0, 700), /store\.page\(goingBack \? 1 : -1\)/)
  // The data only swaps once the outgoing content is off-screen — swapping first would
  // flash the new day's data on top of the old one still sliding.
  const easeInAt = slide.indexOf('.easeIn')
  const pageAt = slide.indexOf('store.page(')
  assert.ok(easeInAt > 0 && easeInAt < pageAt, 'the exit animation must start before the data swaps')

  // The old icon-only back arrow read as "go back," not "return to today" — replaced
  // with a plain, clearly-labelled button in the same toolbar slot (already above the
  // date, since the date is the large title below the nav bar row).
  assert.doesNotMatch(today, /arrow\.uturn\.backward/)
  assert.match(today, /store\.resetToToday\(\)/)
  // The slide clears the content's measured width, not the screen's — a split view or
  // resized window changes one without touching the other. (UIScreen.main is also
  // deprecated, and this repo builds warning-free.)
  assert.doesNotMatch(today, /UIScreen\.main/)
  assert.match(today, /let width = pageWidth > 0 \? pageWidth : 420/)
})

test('the Trends axis pickers sit over their own axis, with the legend below the chart', () => {
  const trends = read('../ios/Fuel/Sources/TrendsView.swift')
  // Left-aligned picker above the left axis, right-aligned above the right axis — the
  // old stacked layout put both above the chart with no relation to either axis.
  const pickers = trends.slice(trends.indexOf('private var pickers'), trends.indexOf('private func metricPicker'))
  assert.match(pickers, /HStack\(alignment: \.top\)/)
  assert.match(pickers, /metricPicker\(selection: \$primaryKey[\s\S]*Spacer\(\)[\s\S]*metricPicker\(selection: \$secondaryKey/)
  // The color/label pairing moved out of the picker row into its own legend, rendered
  // after the chart rather than doubling as the axis picker's caption.
  assert.match(trends, /private var legend: some View/)
  const panelBody = trends.slice(trends.indexOf('Panel {'), trends.indexOf('averagesPanel'))
  const chartAt = panelBody.indexOf('chartBody')
  const legendAt = panelBody.indexOf('legend')
  assert.ok(chartAt > 0 && legendAt > chartAt, 'the legend must render after the chart, not before it')
})

test('the compare bar\'s dot and tick sit centered on the bar line, not above it', () => {
  const compare = read('../ios/Fuel/Sources/CompareView.swift')
  const bar = compare.slice(compare.indexOf('private struct CompareBar'))
  // ZStack(alignment: .leading) already centers every child vertically within the 12pt
  // frame — the same frame the Capsule bar is centered in — so a child needs no extra
  // y-offset to land on the bar. The old "y: -3" pushed the tick and dot up off it.
  assert.doesNotMatch(bar, /y: -3/)
  assert.match(bar, /\.offset\(x: pos\(ref\.p50\) - 1\)/)
  assert.match(bar, /\.offset\(x: pos\(value\) - 5\.5\)/)
})

test('the "return to Today" button is a plain titled button, so it lays out as a full pill', () => {
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  // Two earlier attempts — .buttonStyle(.bordered), then a custom Text+Capsule label —
  // both ended up as a circle with the word clipped: a toolbar item built from custom
  // label content is treated as icon-shaped and packed into a fixed round container.
  // A title-only Button is laid out as a capsule sized to its own text instead.
  assert.match(today, /Button\("Today"\) \{/)
  assert.match(today, /\.fixedSize\(\)/)
  const toolbar = today.slice(today.indexOf('.toolbar {'), today.indexOf('.refreshable'))
  assert.doesNotMatch(toolbar, /Capsule\(\)/, 'no hand-rolled capsule — let the system size the button')
  assert.doesNotMatch(toolbar, /label: \{[\s\S]{0,200}Text\("Today"\)/,
    'a custom label view is what caused the circular clipping')
})

test('the bottom tab is called Dashboard, while the page still titles the day it shows', () => {
  // Two different labels for two different things: the tab bar names the destination,
  // the navigation title names which day is on screen — so paging back to Yesterday
  // renames the title without renaming the tab.
  assert.match(read('../ios/Fuel/Sources/FuelApp.swift'),
    /Tab\("Dashboard", systemImage: "flame\.fill", value: AppTab\.today\)/)
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  assert.match(today, /if store\.isViewingToday \{ return "Today" \}/)
  assert.match(today, /if store\.dayOffset == 1 \{ return "Yesterday" \}/)
})

test('widgets never use informal "in/out" language — always Burned/Consumed', () => {
  // Hard rule: the person building this app explicitly rejected "In"/"Out" (and
  // "Eaten") as too casual for a widget a stranger might glance at over your shoulder.
  // Every energy widget must say "Burned" and "Consumed", spelled out, every time.
  for (const file of ['EnergyWidgets', 'FuelWidgetBundle']) {
    const src = read(`../ios/FuelWidgets/Sources/${file}.swift`)
    assert.doesNotMatch(src, /"[Ii]n"/, `${file}.swift uses "In" instead of "Consumed"`)
    assert.doesNotMatch(src, /"[Oo]ut"/, `${file}.swift uses "Out" instead of "Burned"`)
    assert.doesNotMatch(src, /"[Ee]aten"/, `${file}.swift uses "Eaten" instead of "Consumed"`)
    assert.doesNotMatch(src, /in versus out/i, `${file}.swift still has "in versus out" phrasing`)
  }
  const energy = read('../ios/FuelWidgets/Sources/EnergyWidgets.swift')
  assert.match(energy, /Text\("Burned \\\(FuelWidgetFormat\.whole\(s\.burned\)\)"\)/)
  assert.match(energy, /Text\("Consumed \\\(FuelWidgetFormat\.whole\(s\.consumed\)\)"\)/)
  assert.match(energy, /KeyDot\(color: p\.surplusColor, label: "Consumed"/)
  assert.match(energy, /WidgetTitle\(text: "Burned vs\. consumed", palette: p\)/)
  const bundle = read('../ios/FuelWidgets/Sources/FuelWidgetBundle.swift')
  assert.match(bundle, /\.configurationDisplayName\("Burned vs\. consumed"\)/)
})

test('every app API call names a route the server actually dispatches on', () => {
  // The bug this pins: the client asked for `?integration=meals` / `food-history` /
  // `day-detail` / `learning-signals`, but api/mlog.js routes on `fuel_route` only. An
  // unmatched route falls through to the default handler and answers with a payload
  // that decodes as nothing — so saved meals and history looked permanently empty
  // rather than broken, and the user_meals table was never even created.
  const client = read('../ios/Fuel/Sources/FuelClient.swift')
  assert.doesNotMatch(client, /api\/mlog\?integration=/,
    'api/mlog dispatches on fuel_route; ?integration= silently matches nothing')

  const mlog = read('../api/mlog.js')
  // The dispatcher reads exactly one parameter — assert it, so a future rename can't
  // quietly re-open this gap.
  assert.match(mlog, /searchParams\.get\('fuel_route'\)/)

  // Every fuel_route the client asks for must have a branch on the server.
  const asked = [...client.matchAll(/api\/mlog\?fuel_route=([a-z-]+)/g)].map((m) => m[1])
  assert.ok(asked.length >= 10, `expected the app's routes, found ${asked.length}`)
  for (const route of new Set(asked)) {
    assert.match(mlog, new RegExp(`integrationRoute === '${route}'`),
      `the app calls fuel_route=${route}, which api/mlog.js never handles`)
  }
})

test('a failed library load says so instead of rendering as an empty list', () => {
  const store = read('../ios/Fuel/Sources/AppStore.swift')
  // Two `try?`s used to swallow exactly the failure above — an error and "you have
  // logged nothing" produced an identical blank screen, which is why a dead route went
  // unnoticed for so long.
  const fn = store.slice(store.indexOf('func loadLibrary() async'), store.indexOf('func logSavedMeal'))
  assert.doesNotMatch(fn, /try\? client\(\)/)
  assert.match(fn, /case \.failure: failed\.append\("saved meals"\)/)
  assert.match(fn, /case \.failure: failed\.append\("history"\)/)
  assert.match(store, /var libraryError: String\?/)

  const lib = read('../ios/Fuel/Sources/FoodLibraryView.swift')
  assert.match(lib, /if let libraryError = store\.libraryError/)
  // And loading is distinguishable from empty.
  assert.match(lib, /if store\.libraryLoading \{/)
  assert.match(lib, /Text\("Loading your history…"\)/)
})

test('food history is deduplicated, trimmed, and never offers a nutrition-less row', () => {
  const meals = read('../api/_lib/meals.js')
  const fn = meals.slice(meals.indexOf('export async function foodHistory'))
  // Lowercasing alone left "Centrum Multivitamin Gummie " (trailing space) and
  // "centrum multivitamin gummie" as two separate foods in one list.
  assert.match(fn, /btrim\(regexp_replace\(description, '\\\\s\+', ' ', 'g'\)\) AS label/)
  assert.match(fn, /PARTITION BY lower\(label\)/)
  // Within a food, show the most recent row that actually has numbers — otherwise
  // re-logging it without filling calories in blanks out what was already known.
  assert.match(fn, /ORDER BY \(calories_kcal IS NOT NULL\) DESC, occurred_at DESC/)
  // ...while the timestamp stays the true most recent, so ordering is still honest.
  assert.match(fn, /max\(occurred_at\) OVER \(PARTITION BY lower\(label\)\) AS last_logged/)
  assert.match(fn, /ORDER BY last_logged DESC/)
  // A food with no nutrition at all cannot be re-logged as anything useful.
  assert.match(fn, /calories_kcal IS NOT NULL OR protein_g IS NOT NULL/)

  // The client's list identity is normalised the same way, so even an older server
  // deployment cannot produce two rows sharing a SwiftUI id.
  const client = read('../ios/Fuel/Sources/FuelClient.swift')
  assert.match(client, /static func key\(_ text: String\) -> String/)
  assert.match(client, /var id: String \{ FoodHistoryItem\.key\(description\) \}/)

  const lib = read('../ios/Fuel/Sources/FoodLibraryView.swift')
  assert.match(lib, /seen\.insert\(key\)\.inserted/)
  // The meal-item editor renders history and common foods back to back, so a food in
  // both showed up twice with two different sets of numbers.
  assert.match(lib, /let alreadyOffered = Set\(historyMatches\.map \{ FoodHistoryItem\.key\(\$0\.description\) \}\)/)
  assert.match(lib, /\.filter \{ !alreadyOffered\.contains\(FoodHistoryItem\.key\(\$0\.name\)\) \}/)
})

test('a past day\'s blank entries can be filled, and the day refreshes to show it', () => {
  const store = read('../ios/Fuel/Sources/AppStore.swift')
  // Reading today's entries here is what forced the fill affordance to be hidden on
  // older days — which is exactly where blank entries pile up, since nobody is around
  // to notice them at log time.
  const fill = store.slice(store.indexOf('func fillMissingNutrition'), store.indexOf('// MARK: - Coach'))
  assert.match(fill, /let entries = viewingFoodEntries\.filter \{ \$0\.needsNutrition \}/)
  assert.doesNotMatch(fill, /dashboard\?\.today\.foodEntries/)

  const today = read('../ios/Fuel/Sources/TodayView.swift')
  assert.match(today, /if !missing\.isEmpty \{/)
  assert.doesNotMatch(today, /if store\.isViewingToday, !missing\.isEmpty/)

  // A past day is served from dayDetailCache, which a dashboard reload never touches —
  // so an edit, a delete or a fill would appear to do nothing until you paged away.
  assert.match(store, /func refreshViewingDay\(\) async \{/)
  // It refetches into place rather than clearing first — see the delete test for why.
  assert.match(store, /if let detail = try\? await client\(\)\.dayDetail\(date: date\) \{ dayDetailCache\[date\] = detail \}/)
  const load = store.slice(store.indexOf('func load() async'), store.indexOf('func loadEditableState'))
  assert.match(load, /await refreshViewingDay\(\)/)
})

test('a past day\'s entries come back in the order they were eaten', () => {
  // getDayDetail had no ORDER BY at all, so an older day's food and supplements arrived
  // in whatever order the rows happened to come out of Postgres.
  const dash = read('../api/_lib/neon-dashboard.js')
  const fn = dash.slice(dash.indexOf('export async function getDayDetail'), dash.indexOf('export async function getNeonDashboard'))
  assert.match(fn, /f\.occurred_at AT TIME ZONE[\s\S]*?ORDER BY f\.occurred_at ASC/)
  assert.match(fn, /FROM supplements[\s\S]*?ORDER BY occurred_at ASC/)
  assert.match(fn, /FROM hk_workouts[\s\S]*?ORDER BY start_at ASC/)
})

test('swiping a food row opens that row, and never drags the day underneath it', () => {
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  // Both gestures are live at once — the page swipe is a simultaneousGesture on purpose
  // so it can coexist with vertical scrolling — so the row has to actively call the
  // page one off. It wins the race because it engages at 8pt and the page waits for 40.
  assert.match(today, /@Binding var rowSwiping: Bool/)
  assert.match(today, /isDragging = true; dragStartOffset = offset; rowSwiping = true/)
  assert.match(today, /isDragging = false\s*\n\s*rowSwiping = false/)
  assert.match(today, /rowSwiping: \$rowSwiping\)/)
  // The page gesture stands down for both phases of a row swipe.
  const page = today.slice(today.indexOf('DragGesture(minimumDistance: 40)'), today.indexOf('.onChange(of: store.highlightedEntryID)'))
  assert.match(page, /onChanged[\s\S]*?!pageAnimating, !rowSwiping/)
  assert.match(page, /onEnded[\s\S]*?!pageAnimating, !rowSwiping/)
})

test('today refuses to drag toward a day that does not exist', () => {
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  // canPage already blocked the commit, but the content still rubber-banded and sprang
  // back, which reads as the page being loose rather than as a wall. Nothing moves now.
  const changed = today.slice(today.indexOf('DragGesture(minimumDistance: 40)'), today.indexOf('.onEnded { value in'))
  assert.match(changed, /guard store\.canPage\(value\.translation\.width > 0 \? 1 : -1\) else \{ return \}/)
  const guardAt = changed.indexOf('store.canPage')
  const assignAt = changed.indexOf('pageDragOffset = value.translation.width')
  assert.ok(guardAt > 0 && guardAt < assignAt, 'the bounds check must come before the offset is applied')
})

test('long scrolling screens build their cards lazily', () => {
  // Eagerly, the dashboard constructed all eight section cards — several of them
  // SwiftUI Charts — on every single render, including once per frame while paging.
  for (const [file, what] of [
    ['TodayView', 'the dashboard sections'],
    ['TrendsView', 'the Compare cards under the chart'],
    ['ExploreView', 'the metric list'],
    ['CompareView', 'the four comparison group panels'],
  ]) {
    assert.match(read(`../ios/Fuel/Sources/${file}.swift`), /LazyVStack/, `${what} should be lazy`)
  }
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  // A lazy stack means a row inside a card is not a scroll target until the card
  // exists, so the jump-to-what-I-just-logged scroll goes via the card first.
  assert.match(today, /scrollTo\("foodConsumed", anchor: \.top\)/)
  assert.match(today, /scrollTo\(id, anchor: \.center\)/)
  assert.match(today, /\.id\(key\)/)
})

test('widget timelines are only reloaded when the widgets would actually look different', () => {
  const pub = read('../ios/Fuel/Sources/WidgetPublisher.swift')
  // publish() runs on every dashboard load — launch, foreground, each refresh, after
  // every food edit, after every sync, on every day paged to — and reloadAllTimelines
  // is a cross-process call. Almost all of those produce identical widget content.
  assert.match(pub, /if var previous = FuelWidgetStore\.load\(\) \{/)
  assert.match(pub, /previous\.updated = snapshot\.updated/)
  assert.match(pub, /if previous == snapshot \{ return \}/)
  const publishFn = pub.slice(pub.indexOf('static func publish'), pub.indexOf('static func republishPalette'))
  const guardAt = publishFn.indexOf('if previous == snapshot')
  const reloadAt = publishFn.indexOf('WidgetCenter.shared.reloadAllTimelines()')
  assert.ok(guardAt > 0 && guardAt < reloadAt, 'the equality check must short-circuit before the reload')
})

test('a food already saved as a meal shows a filled bookmark that removes it again', () => {
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  // Filled + "Added" when it is already in the library, outline + "Add" when it is not,
  // and the filled one takes it back out rather than saving a second copy.
  assert.match(today, /actionButton\("Added", "bookmark\.fill", DashboardTheme\.shared\.accent\)/)
  assert.match(today, /actionButton\("Add", "bookmark", DashboardTheme\.shared\.accent\)/)
  assert.match(today, /store\.deleteSavedMeal\(saved\)/)
  assert.match(today, /private var savedAsMeal: SavedMeal\? \{ store\.savedMeal\(matching: entry\.food\) \}/)

  // Matched the same way the library dedups, so capitalisation or spacing at save time
  // does not make an already-saved meal look unsaved.
  const store = read('../ios/Fuel/Sources/AppStore.swift')
  assert.match(store, /func savedMeal\(matching food: String\?\) -> SavedMeal\?/)
  assert.match(store, /savedMeals\.first \{ FoodHistoryItem\.key\(\$0\.name\) == key \}/)

  // The library has to be loaded before the sheet is ever opened, or every row would
  // show as unsaved on a fresh launch.
  assert.match(read('../ios/Fuel/Sources/FuelApp.swift'), /async let library: Void = store\.loadLibrary\(\)/)
})

test('a finger landing on a food row can still scroll the page', () => {
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  const row = today.slice(today.indexOf('struct FoodEntryRow: View'), today.indexOf('\n/// The website\'s NUTRIENT_DISPLAY'))
  // The row must not carry a SwiftUI DragGesture at all. Plain or simultaneous, one
  // takes the touch as soon as it passes its minimum distance in ANY direction, which
  // made every logged food a spot where the page refused to scroll. Filtering by
  // direction inside onChanged is too late — recognition has already happened.
  assert.doesNotMatch(row, /DragGesture\(/,
    'a DragGesture here claims vertical touches from the scroll view')
  assert.match(row, /\.gesture\(swipeGesture\)/)
  assert.match(row, /private var swipeGesture: HorizontalPan/)

  // The fix lives in the recognizer: UIKit asks before recognising, so a mostly-
  // vertical drag can be declined outright and left to the scroll view.
  const pan = read('../ios/Fuel/Sources/HorizontalPan.swift')
  assert.match(pan, /struct HorizontalPan: UIGestureRecognizerRepresentable/)
  assert.match(pan, /func gestureRecognizerShouldBegin/)
  assert.match(pan, /return abs\(velocity\.x\) > abs\(velocity\.y\)/)
  assert.match(pan, /shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer\) -> Bool \{ true \}/)
  // It has to be in the app target, not just on disk.
  assert.match(read('../ios/Fuel/project.yml'), /path: Sources/)
})

test('consumed is a themeable colour, not fixed ink', () => {
  const theme = read('../ios/Fuel/Sources/DashboardTheme.swift')
  assert.match(theme, /var consumed: UInt32/)
  assert.match(theme, /private\(set\) var consumed: Color/)
  assert.match(theme, /func setConsumed\(_ color: Color\)/)
  assert.match(theme, /d\.set\(consumed\.hexString, forKey: "fuelDashConsumed"\)/)
  assert.match(theme, /ColorPicker\("Consumed", selection: Binding\(/)
  // Every preset carries one, and the swatch row shows it.
  const presets = theme.slice(theme.indexOf('static let presets'), theme.indexOf('@MainActor'))
  assert.equal((presets.match(/consumed: 0x/g) || []).length, 6, 'every preset needs a consumed colour')
  assert.match(theme, /preset\.consumed, preset\.positive, preset\.negative/)
  // A colour added after someone picked a preset must fall back to that preset's value,
  // not to Default's, or one stripe of their palette silently changes scheme.
  assert.match(theme, /DashboardPalette\.presets\.first \{ \$0\.name == resolvedName \} \?\? DashboardPalette\.presets\[0\]/)

  // And it is actually used where intake is drawn.
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  assert.match(today, /BoxDef\(key: "consumed", color: theme\.consumed/)
  assert.match(today, /Rectangle\(\)\.fill\(DashboardTheme\.shared\.consumed\)/)
  assert.match(today, /foregroundStyle\(DashboardTheme\.shared\.consumed\)\.interpolationMethod\(\.stepEnd\)/)
})

test('blood results are stored exactly as the lab reported them', () => {
  const blood = read('../api/_lib/blood.js')
  // Markers live with their panel because a value only means anything beside the range
  // printed next to it, and lab ranges differ and get revised.
  assert.match(blood, /markers jsonb NOT NULL DEFAULT '\[\]'::jsonb/)
  assert.match(blood, /user_id uuid NOT NULL REFERENCES app_users\(id\) ON DELETE CASCADE/)
  // Every query scoped to one user — bloodwork is the last thing that should leak.
  for (const [, query] of blood.matchAll(/(FROM blood_panels[\s\S]{0,160}?)(?:`|ORDER)/g)) {
    assert.match(query, /user_id = \$\{userId\}/, `unscoped blood_panels query: ${query.trim()}`)
  }
  assert.match(blood, /DELETE FROM blood_panels WHERE user_id = \$\{userId\} AND id = \$\{id\}/)

  // High/low is arithmetic against the printed range, never the report's own flag
  // column and never the model's opinion — the two must not be able to disagree.
  assert.match(blood, /if \(low != null && value < low\) flag = 'low'/)
  assert.match(blood, /else if \(high != null && value > high\) flag = 'high'/)
  // A cancelled line is still a line: dropping it would make the panel look like the
  // test was never ordered.
  assert.match(blood, /valueText: text\(raw\?\.valueText, 120\)/)
  // A `date` column comes back as a Date, and String()ing one gives "Thu Jan 02".
  assert.match(blood, /databaseDateKey\(row\.collected_on\)/)
  assert.doesNotMatch(blood, /String\(row\.collected_on\)\.slice/)

  const mlog = read('../api/mlog.js')
  assert.match(mlog, /integrationRoute === 'blood'/)
  assert.match(mlog, /await listBloodPanels\(auth\.id\)/)
})

test('the app transcribes a pasted lab report rather than interpreting it', () => {
  const ai = read('../ios/Fuel/Sources/OnDeviceAI.swift')
  assert.match(ai, /struct ParsedBloodPanel: Codable/)
  assert.match(ai, /func parseBloodPanel\(_ report: String\) async throws -> ParsedBloodPanel/)
  // The one thing a model must not do with bloodwork is improve on it.
  assert.match(ai, /Never invent, correct, convert or round a value, a unit or a range\./)
  assert.match(ai, /Never substitute \\\s*\n\s*today's date for a missing one\./)
  // Both AI paths, like every other capability in this app.
  assert.match(read('../ios/Fuel/Sources/RemoteAI.swift'), /static func parseBloodPanel/)

  const store = read('../ios/Fuel/Sources/AppStore.swift')
  assert.match(store, /func saveBloodPanel\(fromReport report: String\) async -> Bool/)
  assert.match(store, /OnDeviceAI\.shared\.parseBloodPanel\(report\)/)
})

test('every blood marker shown is explained from a cited source, without being judged', () => {
  const markers = read('../ios/Fuel/Sources/BloodMarkers.swift')
  const entries = [...markers.matchAll(/BloodMarkerInfo\(\s*\n?\s*name: "([^"]+)"/g)].map((m) => m[1])
  assert.ok(entries.length >= 30, `expected a real catalogue, found ${entries.length}`)
  // Every entry carries both an explanation and the reference it came from.
  const blocks = markers.split('BloodMarkerInfo(').slice(1)
  for (const block of blocks) {
    assert.match(block, /meaning: "/, 'every marker needs a meaning')
    assert.match(block, /source: "/, 'every marker needs a source')
  }
  // Names are matched loosely, since labs spell the same test several ways.
  assert.match(markers, /name\.lowercased\(\)\.filter \{ \$0\.isLetter \|\| \$0\.isNumber \}/)
  // Aliases are folded into the lookup table rather than rescanned on every call.
  assert.match(markers, /for name in \[entry\.name\] \+ entry\.aliases/)

  // The UI states what the marker is and whether it fell outside the lab's range, and
  // explicitly declines to interpret the result.
  const view = read('../ios/Fuel/Sources/BloodView.swift')
  assert.match(view, /It does not interpret your results/)
  assert.match(view, /Outside a reference range is not the same as a problem/)
  assert.match(view, /Text\("Source: \\\(info\.source\)"\)/)
  assert.match(read('../ios/Fuel/Sources/MoreView.swift'), /NavigationLink \{ BloodView\(\) \}/)
})

test('a blood panel can be corrected, and a fixed value stops being flagged', () => {
  const blood = read('../api/_lib/blood.js')
  assert.match(blood, /export async function updateBloodPanel/)
  // Markers are replaced wholesale — a merge would make deleting a row inexpressible.
  assert.match(blood, /markers = COALESCE\(\$\{markers \? JSON\.stringify\(markers\) : null\}::jsonb, markers\)/)
  // ...but the update still runs through normalizeMarker, so an edited value re-derives
  // its own flag rather than keeping the one the mistyped number earned.
  const fn = blood.slice(blood.indexOf('export async function updateBloodPanel'))
  assert.match(fn, /body\.markers\.map\(normalizeMarker\)/)
  // Scoped, so one account cannot edit another's results.
  assert.match(fn, /WHERE user_id = \$\{userId\} AND id = \$\{id\}/)

  const mlog = read('../api/mlog.js')
  const handler = mlog.slice(mlog.indexOf('async function handleBloodPanels'), mlog.indexOf('const ISO_DATE_RE'))
  assert.match(handler, /\['GET', 'POST', 'PUT', 'DELETE'\]/)
  assert.match(handler, /await updateBloodPanel\(auth\.id, id, body\)/)

  const view = read('../ios/Fuel/Sources/BloodView.swift')
  assert.match(view, /struct EditBloodPanelSheet: View/)
  assert.match(view, /struct EditBloodMarkerView: View/)
  assert.match(view, /DatePicker\("Collected", selection: \$date, displayedComponents: \.date\)/)
  // A report with no stated date keeps having no date rather than being given today's.
  assert.match(view, /Toggle\("Panel has a date", isOn: \$hasDate\.animation\(\)\)/)
  assert.match(view, /collectedOn: hasDate \? BloodFormat\.iso\(date\) : nil/)
  // Rows are addressed by index: a marker's id changes as it is edited, and identity
  // shifting mid-edit would pop the editor off the navigation stack.
  assert.match(view, /ForEach\(markers\.indices, id: \\\.self\)/)
  // The detail screen reads the stored copy, so an edit shows up without going back.
  assert.match(view, /private var current: BloodPanel \{ store\.bloodPanels\.first \{ \$0\.id == panel\.id \} \?\? panel \}/)

  assert.match(read('../ios/Fuel/Sources/AppStore.swift'), /func updateBloodPanel\(_ panel: BloodPanel/)
  assert.match(read('../ios/Fuel/Sources/FuelClient.swift'), /method: "PUT", body: body\)\)\s*\n\s*return try JSONDecoder\(\)\.decode\(Response\.self, from: data\)\.panel/)
})

test('each blood value is plotted against the range its own lab printed', () => {
  const view = read('../ios/Fuel/Sources/BloodView.swift')
  assert.match(view, /struct BloodRangeBar: View/)
  // Drawn only when there is both a number and a range to place it in.
  assert.match(view, /if marker\.value != nil, marker\.referenceLow != nil \|\| marker\.referenceHigh != nil \{/)
  // A one-sided range ("<150") still plots rather than dropping the bar.
  assert.match(view, /let low = marker\.referenceLow \?\? min\(marker\.value \?\? 0, marker\.referenceHigh \?\? 0\)/)
  assert.match(view, /let high = marker\.referenceHigh \?\? max\(marker\.value \?\? 0, low\)/)
  // The domain widens to keep an out-of-range dot on screen instead of clipped to an edge.
  assert.match(view, /let domainMin = min\(low - spread \* 0\.35, value - spread \* 0\.12\)/)
  assert.match(view, /let domainMax = max\(high \+ spread \* 0\.35, value \+ spread \* 0\.12\)/)
  // Same centring the Compare bars needed: no stray y-offset pushing the dot off the bar.
  const bar = view.slice(view.indexOf('struct BloodRangeBar'))
  assert.doesNotMatch(bar.slice(0, 2000), /y: -\d/)
  assert.match(bar, /\.offset\(x: position\(value\) - 5\.5\)/)
  assert.match(bar, /marker\.isOutOfRange \? Color\.orange/)
  // Readable without seeing it.
  assert.match(bar, /accessibilityValue\(marker\.isOutOfRange/)
})

test('independent reads are issued together rather than one after another', () => {
  // The database work itself is trivial here (the dashboard's food query plans to a
  // 0.15ms scan of a few hundred rows); what costs is the number of sequential round
  // trips. Verified against production: 1046ms sequential -> 327ms parallel, same bytes.
  const mlog = read('../api/mlog.js')
  assert.match(mlog, /const \[dashboard, intraday, rolling24h\] = await Promise\.all\(\[\s*\n\s*getNeonDashboard\(auth\.id\), getIntradayEnergy\(auth\.id\), getRolling24h\(auth\.id\),\s*\n\s*\]\)/)

  // The launch path waited on four independent reads in turn.
  const app = read('../ios/Fuel/Sources/FuelApp.swift')
  assert.match(app, /async let dashboard: Void = store\.load\(\)/)
  assert.match(app, /async let editable: Void = store\.loadEditableState\(\)/)
  assert.match(app, /async let library: Void = store\.loadLibrary\(\)/)
  assert.match(app, /_ = await \(dashboard, editable, context, library\)/)

  // The library's two shelves go out together again, without going back to the `try?`
  // that hid a dead route for weeks — a Result keeps the failures separable.
  const store = read('../ios/Fuel/Sources/AppStore.swift')
  assert.match(store, /async let mealsResult = fetchSavedMeals\(\)/)
  assert.match(store, /async let historyResult = fetchFoodHistory\(\)/)
  assert.match(store, /private func fetchSavedMeals\(\) async -> Result<\[SavedMeal\], Error>/)

  // syncHealth already ends with load(), so pull-to-refresh was fetching twice.
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  assert.match(today, /\.refreshable \{ await store\.syncHealth\(reason: "pull to refresh"\) \}/)
  assert.doesNotMatch(today, /syncHealth\(reason: "pull to refresh"\)\s*\n\s*await store\.load\(\)/)
})

test('paging back a day lands on data that is already there', () => {
  const store = read('../ios/Fuel/Sources/AppStore.swift')
  assert.match(store, /private func prefetchNextDay\(\)/)
  // Runs after both the cache-hit and the fetch paths, so a run of swipes stays ahead.
  const fn = store.slice(store.indexOf('func loadViewingDay() async'), store.indexOf('private func prefetchNextDay'))
  assert.equal((fn.match(/prefetchNextDay\(\)/g) || []).length, 2,
    'prefetch must follow both the cached and the fetched path')
  // Never shows a spinner for a day nobody is looking at.
  const pf = store.slice(store.indexOf('private func prefetchNextDay'))
  assert.doesNotMatch(pf.slice(0, 900), /dayDetailLoading/)
  // A fast series of swipes must not queue the same request repeatedly.
  assert.match(pf, /!prefetching\.contains\(date\) else \{ return \}/)
  assert.match(pf, /prefetching\.insert\(date\)/)
  assert.match(pf, /self\.prefetching\.remove\(date\)/)
})

test('blood marker lookups are a table, not a scan that rebuilds its keys', () => {
  const markers = read('../ios/Fuel/Sources/BloodMarkers.swift')
  // A panel asks twice per result — once to group it, once to explain it — and the old
  // scan re-derived every catalogue entry's key on each call.
  assert.match(markers, /private static let index: \[String: BloodMarkerInfo\]/)
  assert.match(markers, /static func info\(for name: String\) -> BloodMarkerInfo\? \{ index\[key\(name\)\] \}/)
  // A canonical name must not be displaced by another marker's alias for it.
  assert.match(markers, /if table\[key\(name\)\] == nil \{ table\[key\(name\)\] = entry \}/)
})

test('lifetime distance is put next to real journeys, with the equator as the ring', () => {
  const server = read('../api/_lib/journeys.js')
  // Every day on record, not the dashboard's 30-day window — the number is only
  // interesting after years of it.
  assert.match(server, /FROM health_daily\s*\n\s*WHERE user_id = \$\{userId\}/)
  assert.doesNotMatch(server, /interval '30 days'/)
  assert.match(server, /swimmingMiles: \(row\?\.swimming_yards \?\? 0\) \/ 1760/)
  assert.match(read('../api/mlog.js'), /integrationRoute === 'journeys'/)

  const journeys = read('../ios/Fuel/Sources/Journeys.swift')
  assert.match(journeys, /static let earthCircumferenceMiles = 24_901\.0/)
  // Real routes at published lengths, each citing where the length comes from.
  const entries = [...journeys.matchAll(/Journey\(name: "([^"]+)"/g)].map((m) => m[1])
  assert.ok(entries.length >= 20, `expected a real catalogue, found ${entries.length}`)
  for (const block of journeys.split('Journey(name:').slice(1)) {
    assert.match(block, /source: "/, 'every journey needs its length sourced')
    assert.match(block, /modes: \[/, 'every journey needs the modes it suits')
  }
  assert.match(journeys, /"Alcatraz to shore"[\s\S]{0,120}miles: 1\.25/)
  assert.match(journeys, /"The English Channel"[\s\S]{0,120}miles: 21/)
  // The list always ends on something still ahead rather than trailing off.
  assert.match(journeys, /let next = pool\.first \{ \$0\.miles > miles \}/)

  const view = read('../ios/Fuel/Sources/JourneysView.swift')
  // The drawn ring was replaced by a real globe — see the globe test below.
  assert.match(view, /GlobeView\(fraction: laps, miles: selectedMiles\)/)
  // Deselecting everything would leave nothing to draw.
  assert.match(view, /if selected\.count > 1 \{ selected\.remove\(mode\) \}/)
  // Honest about walking and running arriving as one figure.
  assert.match(view, /counted together rather than split on a guess/)
  assert.match(read('../ios/Fuel/Sources/MoreView.swift'), /NavigationLink \{ JourneysView\(\) \}/)
})

test('the segmented control is never rasterized into a coloured block', () => {
  // drawingGroup() renders through Metal, which does not reproduce system-drawn
  // controls: the Day/Week/Month picker came out as a solid yellow rectangle for the
  // length of every page transition. The LazyVStack is what actually made paging
  // cheap, so the rasterization was removed rather than worked around.
  const today = read('../ios/Fuel/Sources/TodayView.swift')
  assert.doesNotMatch(today, /drawingGroup\(\)/)
  assert.doesNotMatch(today, /RasterizeWhilePaging/)
  assert.match(today, /LazyVStack/)
})

test('deleting an entry leaves you where you were', () => {
  const store = read('../ios/Fuel/Sources/AppStore.swift')
  // Clearing the cache first left the day with nothing in it until the reply came
  // back; the page collapsed and took the scroll position to the top with it.
  const refresh = store.slice(store.indexOf('func refreshViewingDay() async'), store.indexOf('func loadViewingDay() async'))
  assert.doesNotMatch(refresh, /dayDetailCache\[date\] = nil/)
  assert.match(refresh, /if let detail = try\? await client\(\)\.dayDetail\(date: date\) \{ dayDetailCache\[date\] = detail \}/)
  // The row goes as soon as it is tapped, rather than after a round trip.
  assert.match(store, /private func removeLocally\(_ ids: \[String\]\)/)
  assert.match(store, /dashboard\?\.today\.foodEntries\.removeAll \{ doomed\.contains\(\$0\.id\) \}/)
  const single = store.slice(store.indexOf('func deleteFood(_ entry: FoodEntry) async'), store.indexOf('private func removeLocally'))
  assert.match(single, /removeLocally\(\[entry\.id\]\)/)
  assert.match(store.slice(store.indexOf('func deleteFoods')), /removeLocally\(ids\)/)
})

test('a photo can come from the camera roll, with the same chance to add context', () => {
  const camera = read('../ios/Fuel/Sources/CameraLogView.swift')
  assert.match(camera, /import PhotosUI/)
  assert.match(camera, /PhotosPicker\(selection: \$pickedPhoto, matching: \.images, photoLibrary: \.shared\(\)\)/)
  assert.match(camera, /Image\(systemName: "photo\.on\.rectangle"\)\.foregroundStyle\(\.white\)/)
  // Lands in the same context sheet the blue shutter uses.
  assert.match(camera, /askingForContext = true\s*\n\s*\}\s*\n\s*\/\/ Cleared so picking the same photo twice/)
  // Picking the same photo twice in a row must still register.
  assert.match(camera, /pickedPhoto = nil/)
  // A twelve-megapixel library photo is not what the camera path produces.
  assert.match(camera, /static func downscaled\(_ data: Data, maxDimension: CGFloat = 1280\)/)
  assert.match(camera, /jpegData\(compressionQuality: 0\.8\)/)
  // Placement is asserted in its own test below.
})

test('the album button mirrors the context shutter on the other side of capture', () => {
  const camera = read('../ios/Fuel/Sources/CameraLogView.swift')
  const row = camera.slice(camera.indexOf('private var shutterRow'), camera.indexOf('static func downscaled'))
  const pickerAt = row.indexOf('PhotosPicker')
  const shutterAt = row.indexOf('Circle().stroke(.white, lineWidth: 4)')
  const bubbleAt = row.indexOf('text.bubble.fill')
  assert.ok(pickerAt > 0 && pickerAt < shutterAt && shutterAt < bubbleAt,
    'album left, capture centre, context bubble right')
  assert.doesNotMatch(row, /Color\.clear\.frame\(width: 52 \* 2/, 'no spacer needed once it is balanced')
})

test('the Coach transcript survives a relaunch, for a week', () => {
  const store = read('../ios/Fuel/Sources/AppStore.swift')
  assert.match(store, /struct ChatMessage: Identifiable, Equatable, Codable/)
  assert.match(store, /static let transcriptWindow: TimeInterval = 7 \* 24 \* 60 \* 60/)
  assert.match(store, /var messages: \[ChatMessage\] = \[\] \{\s*\n\s*didSet \{ persistMessages\(\) \}/)
  assert.match(store, /restoreMessages\(\)/)
  // An unanswered proposal must not come back days later still awaiting a tap.
  assert.match(store, /enum CodingKeys: String, CodingKey \{ case id, role, text, loggedFood, isPlan, at \}/)
  // Photos are the bulk of a message and UserDefaults is the wrong place for them.
  assert.match(store, /copy\.photo = nil/)
})

test('the constants live in their own fields, and Compare reads them', () => {
  const sheets = read('../ios/Fuel/Sources/EditSheets.swift')
  assert.match(sheets, /numberRow\("Height", unit: "in", text: \$heightIn\)/)
  assert.match(sheets, /numberRow\("Weight", unit: "lb", text: \$weightLb\)/)
  assert.match(sheets, /numberRow\("Age", unit: "years", text: \$age\)/)
  assert.match(sheets, /Picker\("Sex", selection: \$sex\)/)
  // Saved on the goals PUT, which already carries the profile half of that row.
  assert.match(sheets, /private func saveProfile\(\) async/)
  assert.match(read('../ios/Fuel/Sources/FuelClient.swift'), /var sex: String\?/)
  assert.match(read('../api/_lib/goals.js'), /ALTER TABLE user_goals ADD COLUMN IF NOT EXISTS sex text/)
  assert.match(read('../api/_lib/goals.js'), /function normalizeSex/)

  // Compare uses the stored answer when there is one, so the reference table is right
  // without anyone remembering the segmented control exists.
  const compare = read('../ios/Fuel/Sources/CompareView.swift')
  assert.match(compare, /case "f": return \.female/)
  assert.match(compare, /if store\.dashboard\?\.goalProfile\?\.sex == nil \{/)
})

test('body measurements are one row per reading, and BMI is never stored', () => {
  const body = read('../api/_lib/body.js')
  assert.match(body, /CREATE TABLE IF NOT EXISTS body_measurements/)
  // No BMI column: it is height and weight arithmetic, and a stored copy is free to
  // disagree with the two numbers it came from.
  assert.doesNotMatch(body, /bmi\s+double precision/i)
  assert.doesNotMatch(body, /body_mass_index/i)
  // The same HealthKit sample arriving twice is one reading, not two.
  assert.match(body, /CREATE UNIQUE INDEX IF NOT EXISTS body_measurements_hk/)
  assert.match(body, /ON CONFLICT \(user_id, hk_uuid\) WHERE hk_uuid IS NOT NULL DO UPDATE/)
  assert.match(body, /Enter at least one measurement\./)
  for (const [, query] of body.matchAll(/(FROM body_measurements[\s\S]{0,140}?)(?:`|ORDER)/g)) {
    assert.match(query, /user_id = \$\{userId\}/, `unscoped body_measurements query: ${query.trim()}`)
  }

  const client = read('../ios/Fuel/Sources/FuelClient.swift')
  assert.match(client, /func bmi\(heightIn: Double\?\) -> Double\? \{/)
  assert.match(client, /703 \* weightLb \/ \(heightIn \* heightIn\)/)
  // Reachable from the Log screen's own menu, and able to pull what a scale already
  // wrote to Health.
  assert.match(read('../ios/Fuel/Sources/CameraLogView.swift'), /Label\("Log body weight & measurements", systemImage: "figure\.stand"\)/)
  assert.match(read('../ios/Fuel/Sources/BodyView.swift'), /Label\("Import from Apple Health", systemImage: "heart\.fill"\)/)
  const health = read('../ios/Fuel/Sources/HealthBody.swift')
  assert.match(health, /\$0\.uuid\.uuidString/)
  // A scale writes weight, fat and lean mass as separate samples in one burst.
  assert.match(health, /abs\(\$0\.0\.timeIntervalSince\(date\)\) < 120/)
})

test('each journey draws its own route, traced once per lap, green through red', () => {
  const art = read('../ios/Fuel/Sources/JourneyArt.swift')
  assert.match(art, /struct JourneyRoute: Shape/)
  for (const kind of ['crossing', 'trail', 'wall', 'river', 'loop', 'coast', 'road', 'equator']) {
    assert.match(art, new RegExp(`case \\.${kind}:`), `${kind} needs its own drawing`)
  }
  // One stroke per lap, staggered, ramping green to red.
  assert.match(art, /ForEach\(0\.\.<drawn, id: \\\.self\)/)
  assert.match(art, /Color\(hue: 0\.33 \* \(1 - t\)/)
  assert.match(art, /\.delay\(Double\(index\) \* 0\.16\)/)
  // Nothing is drawn until the row is on screen, which is what makes it animate as you
  // scroll past rather than arrive finished.
  assert.match(art, /animate \? portion\(index\) : 0/)
  assert.match(read('../ios/Fuel/Sources/JourneysView.swift'), /\.onScrollVisibilityChange \{ visible in if visible \{ shown = true \} \}/)
  // The Great Wall gets a wall.
  assert.match(read('../ios/Fuel/Sources/Journeys.swift'), /"The Great Wall of China"[\s\S]{0,200}shape: \.wall/)
})

test('the globe is the real Earth, starting where the person actually is', () => {
  const globe = read('../ios/Fuel/Sources/GlobeView.swift')
  assert.match(globe, /\.mapStyle\(\.imagery\(elevation: \.realistic\)\)/)
  assert.match(globe, /interactionModes: \[\.pan, \.rotate, \.zoom\]/)
  assert.match(globe, /\.clipShape\(Circle\(\)\)/)
  // Most-lived-in place, then the current fix, then a named fallback — never 0°/0°,
  // which is a point in the Atlantic and says nothing.
  assert.match(globe, /store\.places\?\.places\.max\(by: \{ \$0\.samples < \$1\.samples \}\)/)
  assert.match(globe, /LocationSampler\.shared\.fixForLogging\(\)/)
  assert.match(globe, /static let fallbackName = "St\. Paul, Minnesota"/)
  // And it says where it is looking.
  assert.match(globe, /Label\("Centred on \\\(placeName\)", systemImage: "mappin\.and\.ellipse"\)/)
  // MKReverseGeocodingRequest, since CLGeocoder is deprecated as of iOS 26.
  assert.match(globe, /MKReverseGeocodingRequest\(location: location\)/)
  assert.doesNotMatch(globe, /CLGeocoder\(\)/)
})
