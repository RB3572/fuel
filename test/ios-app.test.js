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

test('the AI runs on device, not through Gemini', () => {
  const ai = read('../ios/Fuel/Sources/OnDeviceAI.swift')
  assert.match(ai, /import FoundationModels/)
  assert.match(ai, /SystemLanguageModel\.default/)
  // Nothing in the app may reach for a hosted model. Checked against the endpoint and
  // against network calls in the AI layer, since the prose here legitimately explains
  // what it replaced.
  assert.doesNotMatch(ai, /generativelanguage\.googleapis\.com|api\.openai\.com|anthropic\.com/)
  assert.doesNotMatch(ai, /URLSession/)
  const store = read('../ios/Fuel/Sources/AppStore.swift')
  assert.doesNotMatch(store, /generativelanguage\.googleapis\.com/)
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
  assert.match(app, /Tab\("Log", systemImage: "camera\.fill"\) \{ CameraLogView\(\) \}/)
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
  for (const box of ['totalBurned', 'consumed', 'active', 'resting', 'deficit', 'rolling24']) {
    assert.match(today, new RegExp(`boxes.contains\\("${box}"\\)`), `${box} must be renderable`)
  }

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
  assert.match(coach, /\.disabled\(store\.coachThinking \|\| store\.dashboard == nil \|\| !ai\.availability\.isReady\)/)
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
