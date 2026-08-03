# Fuel health sync — Health Logger & /api/health/sync/v1

Fuel gets its Apple Health data from **Health Logger**, a SwiftUI iOS app that lives in
[`ios/HealthLogger`](ios/HealthLogger). The app is a HealthKit bridge and nothing else:
Fuel on the web keeps analytics, charts, AI, calorie math, goals and the UI.

```
HealthKit ──▶ Health Logger ──▶ POST /api/health/sync/v1 ──▶ normalized tables ──▶ health_daily (derived) ──▶ Fuel web
```

The legacy Apple Shortcut (`POST /api/health/import`) keeps working during migration.

## Philosophy

The Shortcut uploaded *today's summary*; the app replicates *the HealthKit store*. The
first sync uploads all history (like the first Dropbox sync); every later sync uploads
only what changed, via `HKAnchoredObjectQuery` — one anchor per data type, stored on
device and mirrored server-side so a reinstall resumes instead of restarting. Raw
samples become the source of truth; `health_daily` becomes a derived cache.

## The protocol (`syncVersion: 1`)

`POST /api/health/sync/v1` — `Authorization: Bearer fuel_…` (the same token Sync setup
already mints; no Google login, no OAuth, no sessions).

```jsonc
{
  "syncVersion": 1,
  "fullSync": false,
  "batch": { "index": 0, "count": 4 },
  "device": { "model": "iPhone17,3", "iosVersion": "26.2", "timezone": "America/Los_Angeles", "lastSync": null },
  "anchors": { "stepCount": "<base64 HKQueryAnchor>" },
  "tables": {
    "dailyTotals":      [{ "date": "2026-08-06", "partialDay": true, "activeEnergy": 412, "steps": 6100, "...": "..." }],
    "quantitySamples":  [{ "uuid": "…", "type": "heartRate", "value": 62, "unit": "count/min", "start": "…", "end": "…", "source": "Apple Watch" }],
    "categorySamples":  [{ "uuid": "…", "type": "sleepAnalysis", "value": 4, "valueName": "asleepREM", "start": "…", "end": "…" }],
    "heartRateSamples": [],   // convenience aliases, normalized into the two above
    "sleepSamples":     [],
    "workoutSamples":   [{ "uuid": "…", "activityType": "running", "start": "…", "end": "…", "duration": 2400, "activeEnergy": 410, "distance": 6800, "route": [[34.14, -118.12, 1700000000, 220]] }],
    "clinicalRecords":  []
  },
  "deleted": { "quantitySamples": ["uuid"], "categorySamples": [], "workouts": [] },
  "snapshot": { "activeEnergy": 412, "restingEnergy": 1180, "totalExpenditure": 1592 }
}
```

`GET /api/health/sync/v1` returns `{ anchors, lastSession, maxSamplesPerRequest }` so a
fresh install adopts existing anchors.

Guarantees, enforced by tests (`test/health-sync.test.js` + the PGlite harness):

- **Idempotent** — every sample upserts on `(user_id, hk_uuid)`; deletions come from
  the same anchored queries; a replayed batch changes nothing, including snapshots.
- **Batched** — ≤ 20,000 samples per request (over-limit requests are refused whole
  with a 413, never half-imported); rows travel as one jsonb array per table, so a
  5,000-sample batch is a handful of statements.
- **Versioned** — a wrong `syncVersion` is a 400 naming the supported version.
- **Skips are named** — malformed rows come back in `stored.skipped`, never dropped
  silently.

## Storage

| Table | Holds |
|---|---|
| `hk_quantity_samples` | steps, heart rate, weight, SpO₂, mobility… `(type, value, unit, start, end, source, device, metadata)` |
| `hk_category_samples` | sleep stages (`value_name`), stand hours, mindfulness |
| `hk_workouts` | workouts + thinned GPS route (`[[lat, lon, unixSecs, altM], …]`) |
| `hk_clinical_records` | FHIR payloads (off by default in the app — needs Apple's health-records entitlement) |
| `health_sync_anchors` | server mirror of per-type `HKQueryAnchor`s |
| `health_sync_sessions` | one row per request, for debugging a stuck device |
| `health_daily` | **derived cache** — same columns the Shortcut wrote, upserted with COALESCE, `source = 'Health Logger'` |
| `health_energy_snapshots` | intraday running totals — the app is this table's **first writer**, which turns on the intraday chart and the measured rolling-24h path |

Daily aggregates are computed **on device** with `HKStatisticsCollectionQuery`, because
only HealthKit deduplicates a watch and a phone counting the same steps. First sync
backfills five years of `dailyTotals`; incremental syncs send a rolling 3 days.

## The app

`ios/HealthLogger` — SwiftUI, iOS 17+, generated with XcodeGen:

```bash
cd ios/HealthLogger && xcodegen generate && open HealthLogger.xcodeproj
```

- **Setup**: paste the token from Fuel → More → Sync setup (Keychain-stored), tap
  Allow Health access, Sync now. One screen; there is nothing else to operate.
- **Sync engine**: pages each type 5,000 samples at a time; uploads a page, then
  commits its anchor — a crash re-uploads at most one page, which the server dedupes.
- **Stays current all day** via three overlapping mechanisms, all funnelling into the
  same engine (cheap when there is nothing new):
  1. HealthKit background delivery + `HKObserverQuery` — iOS wakes the app when new
     samples land (immediate for workouts/sleep, hourly for quantity types);
  2. `BGAppRefreshTask` roughly every 30+ minutes, at iOS's discretion;
  3. a nightly `BGProcessingTask` catch-all — plus a sync on every app open.
- **Adding a type** = one line in `HealthKitCatalog.swift` (+ a backend column mapping
  only if it should surface in `health_daily`). The protocol does not change.

## Migration plan

1. **Now** — both pipelines live. Shortcut writes `source='Apple Shortcuts'`, app
   writes `source='Health Logger'`; COALESCE upserts mean they cannot clobber each
   other's metrics on the same day.
2. **Install** — build to your phone (Xcode, free personal team works), paste token,
   run the first full sync on power + Wi-Fi.
3. **Verify** — dashboard values match; `health_sync_sessions` shows steady syncs;
   intraday chart starts drawing (it never could before).
4. **Cut over** — delete the Shortcut's personal automation. Nothing server-side to
   change.
5. **Remove legacy** (when ready): delete `api/health/import.js`, `import-v2.js`,
   `import-v3.js`, `api/_lib/health-import.js`, and the `/api/health/import-text`
   rewrite. v2/v3 still write to the pre-Neon Google Sheet and are already dead weight.
   `api/health/token.js` **stays** — the app uses the same token system.

## Adding a data type later

1. Add `(identifier, unit)` to `HealthKitCatalog.quantityTypes` (or `categoryTypes`).
2. Ship the app update. Samples flow into `hk_quantity_samples` with no server change.
3. Optionally map it into `health_daily`/`dailyTotals` if the dashboard should chart it.
