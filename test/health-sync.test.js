import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const sync = read('../api/_lib/health-sync.js')
const mlog = read('../api/mlog.js')

// /api/health/sync/v1 — the Health Logger iOS app's replication endpoint. The deep
// behavioural coverage runs against real Postgres in the PGlite harness; these pin the
// wiring and the invariants that must not drift.

test('/api/health/sync/v1 is routed and wired', () => {
  const config = JSON.parse(read('../vercel.json'))
  assert.ok(config.rewrites.some((r) => r.source === '/api/health/sync/v1' && r.destination.includes('health-sync-v1')),
    'the rewrite must exist — the URL is the contract')
  assert.match(mlog, /if \(integrationRoute === 'health-sync-v1'\)/)
  assert.match(mlog, /handleHealthSyncV1/)
})

test('the endpoint authenticates with the existing sync-token model only', () => {
  assert.match(sync, /userForSyncToken\(token\)/)
  // No Google login, no OAuth, no sessions — per the design brief. Checked against the
  // imports, since prose in comments legitimately mentions these by name.
  const imports = sync.split('\n').filter((line) => line.startsWith('import '))
  assert.deepEqual(imports, [
    "import { sql, userForSyncToken } from './db.js'",
    "import { methodNotAllowed, sendJson } from './http.js'",
  ])
})

test('samples are deduplicated by HealthKit UUID and upserts are idempotent', () => {
  for (const table of ['hk_quantity_samples', 'hk_category_samples', 'hk_workouts', 'hk_clinical_records']) {
    assert.match(sync, new RegExp(`${table}[\\s\\S]{0,900}UNIQUE \\(user_id, hk_uuid\\)`), `${table} must be unique per (user, HK UUID)`)
  }
  assert.match(sync, /ON CONFLICT \(user_id, hk_uuid\) DO UPDATE/)
})

test('bulk inserts are one round trip per table, not one per sample', () => {
  // Rows travel as a jsonb array and unpack inside Postgres.
  const bulk = sync.match(/jsonb_array_elements\(/g) || []
  assert.ok(bulk.length >= 4, `expected jsonb bulk unpacking for each sample table, found ${bulk.length}`)
  assert.doesNotMatch(sync, /for \(const sample of (cleanQuantity|cleanCategory|cleanWorkouts)\)/, 'no per-sample insert loops')
})

test('health_daily stays the derived cache with legacy-compatible semantics', () => {
  // Same COALESCE upsert the Shortcut used: a batch that omits a metric never erases it.
  assert.match(sync, /step_count = COALESCE\(EXCLUDED\.step_count, health_daily\.step_count\)/)
  assert.match(sync, /'Health Logger'/)
})

test('the sync writes the snapshot table the intraday chart reads', () => {
  assert.match(sync, /INSERT INTO health_energy_snapshots/)
  // ...idempotently: a replayed batch must not append a duplicate snapshot.
  assert.match(sync, /ORDER BY collected_at DESC LIMIT 1/)
})

test('versioning, batching bounds, and anchor mirroring are enforced', () => {
  assert.match(sync, /SYNC_VERSION = 1/)
  assert.match(sync, /Unsupported syncVersion/)
  assert.match(sync, /MAX_SAMPLES_PER_REQUEST = 20000/)
  assert.match(sync, /statusCode: 413/)
  assert.match(sync, /INSERT INTO health_sync_anchors/)
  assert.match(sync, /health_sync_sessions/)
})

test('a JSON null in the payload is stored as SQL NULL, not the jsonb string "null"', () => {
  // Caught on a real device: a workout with no GPS sends route: null, and `x->'route'`
  // yields jsonb 'null' rather than SQL NULL — so `route IS NOT NULL` matched every
  // routeless workout. nullif() collapses it before it reaches the column.
  for (const field of ['route', 'metadata', 'fhir']) {
    assert.match(sync, new RegExp(`nullif\\(x->'${field}', 'null'::jsonb\\)`),
      `${field} must collapse a JSON null to SQL NULL`)
  }
})

test('acronym type names survive the wire-name rule', () => {
  // "HKQuantityTypeIdentifierVO2Max" -> "vo2Max", not the mangled "vO2Max" the plain
  // lowercase-the-first-letter rule produces.
  const catalog = read('../ios/HealthLogger/Sources/HealthKitCatalog.swift')
  assert.match(catalog, /"VO2Max": "vo2Max"/)
  assert.match(catalog, /if let override = wireNameOverrides\[stripped\] \{ return override \}/)
})

test('the destination is pluggable and the file export cannot disturb a sync', () => {
  const sink = read('../ios/HealthLogger/Sources/SyncSink.swift')
  const engine = read('../ios/HealthLogger/Sources/SyncEngine.swift')
  // Two destinations behind one protocol: a server, and a file.
  assert.match(sink, /final class ServerSink: SyncSink/)
  assert.match(sink, /final class FileExportSink: SyncSink/)
  // The export reads everything and must never move the anchors, or the app would
  // believe the server has data that only ever went to a file.
  assert.match(sink, /final class FileExportSink[\s\S]{0,1200}var advancesAnchors: Bool \{ false \}/)
  // An export must not convince the app it has already sent a full sync to a server.
  assert.match(engine, /if sink\.advancesAnchors \{[\s\S]{0,400}initialSyncComplete = true/)
  assert.match(engine, /run\(sink: sink, fromScratch: true, reason: "export"\)/)
})

test('Fuel stays the one-tap default while any endpoint is allowed', () => {
  const store = read('../ios/HealthLogger/Sources/SyncStore.swift')
  const api = read('../ios/HealthLogger/Sources/FuelAPI.swift')
  assert.match(store, /static let fuelEndpoint = "https:\/\/fuel\.rishib\.com\/api\/health\/sync\/v1"/)
  assert.match(store, /func useFuel\(\)/)
  // Fuel requires a token; a self-hosted destination may authenticate some other way.
  assert.match(store, /isFuelDestination \? !token\.isEmpty : !endpoint\.isEmpty/)
  assert.match(api, /guard !token\.isEmpty else \{ return \}/)
})

test('the legacy Shortcut import is untouched', () => {
  const legacy = read('../api/health/import.js')
  assert.match(legacy, /PARSER_VERSION = 14/)
  assert.doesNotMatch(legacy, /health-sync|hk_quantity/)
})

test('the Shortcut keeps its own endpoint, rewrite and auth', () => {
  // Everything the Shortcut depends on, pinned. The iOS app, OAuth and native sign-in
  // all arrived after this was written; none of them may move it.
  const config = JSON.parse(read('../vercel.json'))
  assert.ok(config.rewrites.some((r) => r.source === '/api/health/import-text'
    && r.destination === '/api/health/import'), 'the Shortcut posts to /api/health/import-text')

  const legacy = read('../api/health/import.js')
  // Its own function and its own auth: it never went through mlog's authenticatedUser,
  // so adding OAuth scopes there cannot have reached it.
  assert.match(legacy, /const user = await userForSyncToken\(token\)\.catch\(\(\) => null\)/)
  assert.doesNotMatch(legacy, /verifyAccessToken|fuel:read|fuel:write/)

  // And the sync-token path api/mlog.js uses is still tried before OAuth, so a
  // Shortcut token keeps working on the dashboard API too.
  const mlog = read('../api/mlog.js')
  const syncTokenAt = mlog.indexOf('await userForSyncToken(token)')
  const oauthAt = mlog.indexOf('verifyAccessToken(token, requiredScopes)')
  assert.ok(syncTokenAt > 0 && oauthAt > syncTokenAt, 'the sync token is still tried first')
})

test('the iOS app and the server agree on the protocol constants', () => {
  const api = read('../ios/HealthLogger/Sources/FuelAPI.swift')
  const engine = read('../ios/HealthLogger/Sources/SyncEngine.swift')
  assert.match(api, /var syncVersion = 1/)
  assert.match(api, /https:\/\/fuel\.rishib\.com\/api\/health\/sync\/v1/.source ? /sync\/v1/ : /sync\/v1/)
  // One row per day is the entire payload. Raw per-sample upload is gone: a watch
  // writes a heart-rate sample every few seconds, those tables reached 481 MB and hit
  // the database's storage ceiling, and nothing in the app or website ever read them.
  assert.match(engine, /payload\.tables\.dailyTotals = try await dailyTotals\(days: days\)/)
  for (const gone of ['quantitySamples =', 'categorySamples =', 'workoutSamples.append', 'PAGE_LIMIT']) {
    assert.ok(!engine.includes(gone), `SyncEngine must no longer upload raw samples (found ${gone})`)
  }
  // The totals still come from HealthKit's own bucketing, which is the only thing that
  // deduplicates a watch and a phone counting the same steps.
  assert.match(engine, /HKStatisticsCollectionQuery|statistics\(metric\.id/)
})

test('raw samples expire but everything the UI reads is kept forever', () => {
  const sync = read('../api/_lib/health-sync.js')

  // Storage ran out because per-sample rows were kept forever — a watch writes a
  // heart-rate sample every few seconds — and every sync then failed outright.
  assert.match(sync, /export const RAW_SAMPLE_RETENTION_DAYS = 7/)
  for (const table of ['hk_quantity_samples', 'hk_category_samples']) {
    assert.match(sync, new RegExp(`DELETE FROM ${table} WHERE ctid IN`), `${table} must be pruned in batches`)
  }

  // The load-bearing invariant: health_daily holds the per-day aggregates that the
  // dashboard, trends and history actually read, and they are computed on device
  // rather than derived from these rows — so pruning must never touch it. hk_workouts
  // is spared too: one row per workout is not a volume problem and its GPS routes
  // cannot be recomputed.
  assert.doesNotMatch(sync, /DELETE FROM health_daily/)
  const pruneStart = sync.indexOf('async function pruneExpiredSamples')
  const pruneEnd = sync.indexOf('\n}', sync.indexOf('return pruned', pruneStart))
  const pruneBody = sync.slice(pruneStart, pruneEnd)
  assert.ok(pruneStart > 0, 'pruneExpiredSamples must exist')
  assert.doesNotMatch(pruneBody, /hk_workouts/, 'workouts (and their routes) must not be pruned')
  assert.doesNotMatch(pruneBody, /health_daily/, 'daily aggregates must never be pruned')

  // Reclaiming has to happen before the inserts: on a full database the insert is what
  // fails, so cleanup afterwards would never be reached.
  const pruneCall = sync.indexOf('await pruneExpiredSamples(db, userId)')
  const firstInsert = sync.indexOf('INSERT INTO hk_quantity_samples')
  assert.ok(pruneCall > 0 && pruneCall < firstInsert, 'prune must run before the first insert')
})

test('every query goes through one client, pointed at the current database', () => {
  const db = read('../api/_lib/db.js')
  // NEW_FUEL_DATABASE_URL and nothing else. DATABASE_URL pointed at a Neon project on
  // someone else's account; keeping it as a fallback is exactly how an app finds its
  // way back to a database nobody meant it to use — silently, and only noticed when the
  // data looks stale. Not booting is the correct failure here.
  assert.match(db, /const url = process\.env\.NEW_FUEL_DATABASE_URL\s*$/m)
  assert.doesNotMatch(db, /process\.env\.DATABASE_URL/,
    'DATABASE_URL must not be readable as a fallback — it is a different account')

  // One chokepoint: any module building its own client would bypass that precedence and
  // quietly keep talking to whichever URL it happened to read.
  const files = readdirSync(new URL('../api/_lib/', import.meta.url))
  for (const file of files.filter((f) => f.endsWith('.js') && f !== 'db.js')) {
    const source = read(`../api/_lib/${file}`)
    assert.doesNotMatch(source, /\bneon\(/, `${file} must use sql() from db.js, not its own client`)
  }
})
