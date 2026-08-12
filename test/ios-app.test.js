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
  assert.match(theme, /DashboardPalette\(name: "Website"/)
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

test('Energy and Macros plot one labelled line per component, and every trend zooms', () => {
  const trends = read('../ios/Fuel/Sources/TrendsView.swift')
  // "Macros" as a single line is the shape of a question nobody asks — the read is how
  // protein, carbs and fat move relative to each other.
  for (const name of ['Protein', 'Carbs', 'Fat', 'Fiber']) {
    assert.match(trends, new RegExp(`series\\("${name}"`), `Macros must plot ${name} as its own series`)
  }
  for (const name of ['Burned', 'Consumed', 'Active', 'Resting']) {
    assert.match(trends, new RegExp(`series\\("${name}"`), `Energy must plot ${name} as its own series`)
  }
  // Shared zoom/scroll component, so Trends and Explore can't drift apart.
  assert.match(trends, /struct ZoomableDateChart<Content: ChartContent>: View/)
  assert.match(trends, /\.chartScrollableAxes\(\.horizontal\)/)
  assert.match(trends, /MagnificationGesture\(\)/)
  assert.match(read('../ios/Fuel/Sources/ExploreView.swift'), /ZoomableDateChart\(dates:/)
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
  // onAppear fired before the scroll view had laid out, so the position was ignored and
  // the chart opened weeks in the past.
  assert.match(today, /\.task\(id: points\.last\?\.date\) \{ scrollPosition = points\.last\?\.date \?\? "" \}/)
  assert.doesNotMatch(today, /\.onAppear \{ scrollPosition = points\.last/)
  assert.match(today, /\.chartXSelection\(value: \$selectedDate\)/)
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

test('the website\'s Lifting, Compare, Explore, Places and Recipes tabs are all reachable from More', () => {
  const more = read('../ios/Fuel/Sources/MoreView.swift')
  for (const [view, label] of [
    ['LiftingView', 'Lifting'], ['CompareView', 'Compare'], ['ExploreView', 'Explore'],
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
