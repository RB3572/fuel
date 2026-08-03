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
  // No secret and no Google client ID in the app: the server brokers Google with the
  // credentials it already holds.
  assert.doesNotMatch(signIn, /client_secret/)
  assert.doesNotMatch(signIn, /apps\.googleusercontent\.com/)
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
