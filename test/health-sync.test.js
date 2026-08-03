import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

test('the legacy Shortcut import is untouched', () => {
  const legacy = read('../api/health/import.js')
  assert.match(legacy, /PARSER_VERSION = 14/)
  assert.doesNotMatch(legacy, /health-sync|hk_quantity/)
})

test('the iOS app and the server agree on the protocol constants', () => {
  const api = read('../ios/HealthLogger/Sources/FuelAPI.swift')
  const engine = read('../ios/HealthLogger/Sources/SyncEngine.swift')
  assert.match(api, /var syncVersion = 1/)
  assert.match(api, /https:\/\/fuel\.rishib\.com\/api\/health\/sync\/v1/.source ? /sync\/v1/ : /sync\/v1/)
  // The app's page size must stay under the server's per-request ceiling.
  const page = Number(engine.match(/PAGE_LIMIT = (\d+)/)?.[1])
  assert.ok(page > 0 && page <= 20000, `PAGE_LIMIT ${page} must fit MAX_SAMPLES_PER_REQUEST`)
  // Anchors commit only after the server acknowledges the page.
  assert.ok(engine.indexOf('api.upload(payload)') < engine.indexOf('saveAnchor(encoded'), 'upload must precede the anchor commit')
})
