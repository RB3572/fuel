# Fuel health sync — `/api/health/sync/v1`

Fuel reads Apple Health **itself**. There is no Shortcut and no companion app in the
path any more: the iOS app owns HealthKit access, computes a summary per day on device,
and posts it.

```
HealthKit ──▶ Fuel (on-device summarising) ──▶ POST /api/health/sync/v1 ──▶ health_daily ──▶ dashboard
```

## One row per day, not a copy of the store

This is the single most important thing to understand, and it is a reversal of the
original design.

An earlier version replicated the entire HealthKit store — every heart-rate sample,
every sleep segment — into `hk_quantity_samples` and `hk_category_samples`, using
`HKAnchoredObjectQuery` with per-type anchors. It worked, and it filled the database
with 482 MB of rows that answered no question the app ever asks. A heart rate every
minute of the night is not something this dashboard plots.

**The sync now sends daily summaries and workouts only.** `payload.tables` carries
`dailyTotals` and `workoutSamples`; the raw-sample tables exist in the protocol but are
sent empty. Daily aggregates are computed **on device** with
`HKStatisticsCollectionQuery`, because only HealthKit deduplicates a watch and a phone
counting the same steps.

Consequences:

- **`health_daily` is the source of truth**, not a derived cache.
- **`fullSync` means "how far back to recompute", not "replicate history"** — five years
  on the first sync, then a rolling three days. See the comment in `SyncEngine.run`.
- **The anchors are vestigial.** They are still in the protocol and still mirrored
  server-side, and `SyncSink.advancesAnchors` still exists for the export path, but
  nothing depends on them for correctness now.

## The protocol (`syncVersion: 1`)

`POST /api/health/sync/v1` — `Authorization: Bearer fuel_…`, the token minted in
More → Apple Health. No Google login, no OAuth, no session.

```jsonc
{
  "syncVersion": 1,
  "fullSync": false,
  "device": { "model": "iPhone17,3", "iosVersion": "26.2", "timezone": "America/Los_Angeles", "lastSync": null },
  "tables": {
    "dailyTotals": [{
      "date": "2026-08-14",
      "partialDay": true,
      "activeEnergy": 412, "restingEnergy": 1180, "steps": 6100,
      "restingHeartRate": 48, "hrv": 92, "sleepHours": 7.98,
      "extras":    { "sleepREMMinutes": 134, "sleepDeepMinutes": 89, "walkingSpeed": 1.42 },
      "extraText": { "sleepStages": "D,-45,-20;C,-20,15;R,15,38" }
    }],
    "workoutSamples": [{ "uuid": "…", "activityType": "running", "start": "…", "end": "…",
                         "duration": 2400, "activeEnergy": 410, "distance": 6800,
                         "route": [[34.14, -118.12, 1700000000, 220]] }]
  },
  "snapshot": { "activeEnergy": 412, "restingEnergy": 1180, "totalExpenditure": 1592 }
}
```

`GET /api/health/sync/v1` returns `{ anchors, lastSession, maxSamplesPerRequest }`.

Guarantees, enforced by `test/health-sync.test.js`:

- **Idempotent** — days upsert on `(user_id, date)`, workouts on `(user_id, hk_uuid)`.
  A replayed batch changes nothing.
- **Versioned** — a wrong `syncVersion` is a 400 naming the supported version.
- **Skips are named** — malformed rows come back in `stored.skipped`, never dropped
  silently.
- **Batched** — over-limit requests are refused whole with a 413, never half-imported.

### `extras` and `extraText`

The original eighteen metrics have real columns. Everything added since — around
thirty-five more across heart, fitness detail, respiratory, body, environmental and
mobility, plus the sleep breakdown — lives in the `extras` jsonb column, merged rather
than replaced:

```sql
extras = COALESCE(health_daily.extras, '{}'::jsonb) || COALESCE(EXCLUDED.extras, '{}'::jsonb)
```

`extras` is numbers only. `extraText` is the same column for the few things that are not
numbers — currently just `sleepStages`, the night's hypnogram, packed as
`"<stage>,<start>,<end>;…"` in minutes around the midnight the night ended on, so a
stage before midnight is negative. Server-side it is bounded by length and character
class. Client-side, `ExtraValues` in `FuelClient.swift` decodes each value as whatever
it turns out to be — a strict `[String: Double]` decode would throw on the string and
take the whole day's extras with it.

`HealthExtras.swift` is the table mapping each key to its label, unit and dashboard card.
**Adding a metric to the dashboard is a line there**, plus a line in
`SyncEngine.extraMetrics`.

## Storage

| Table | Holds |
|---|---|
| `health_daily` | **The source of truth** — one row per day, plus the `extras` jsonb |
| `hk_workouts` | Workouts + thinned GPS route (`[[lat, lon, unixSecs, altM], …]`) |
| `health_energy_snapshots` | Intraday running totals — drives the intraday chart and the measured rolling-24h figure |
| `health_sync_sessions` | One row per request, for debugging a stuck device |
| `health_sync_anchors` | Server mirror of per-type `HKQueryAnchor`s — vestigial, see above |
| `hk_quantity_samples`, `hk_category_samples` | Legacy raw-sample tables. No longer written |

## Staying current

Three overlapping mechanisms, all funnelling into the same engine, all cheap when there
is nothing new:

1. HealthKit background delivery + `HKObserverQuery` — iOS wakes the app when samples
   land (immediate for workouts and sleep, hourly for quantity types);
2. `BGAppRefreshTask`, at iOS's discretion;
3. a nightly `BGProcessingTask` catch-all — plus a sync on every app open.

`SyncStore` makes this configurable: minimum interval between syncs (default 30
minutes), sync on Health update, sync after a workout, and a daily sync at a chosen
time. `maySyncInBackground(reason:now:)` is the single gate.

## Authorization — two traps

Both of these have shipped as bugs. Read `HANDOFF.md` §6.6.

1. **A metric the user was never asked about throws `errorAuthorizationNotDetermined`.**
   Under `withThrowingTaskGroup` a single such metric aborts the whole sync, so adding
   new read types silently killed the ones that already worked. `statistics()` is
   non-throwing and resolves to empty for exactly this reason. Keep it that way.
2. **HealthKit never re-prompts on its own.** A build that reads more types than the
   previous one must ask again, or the new metrics read empty forever.
   `HealthKitCatalog.readTypesSignature` fingerprints the read set and
   `AppStore.requestHealthAccessIfCatalogueGrew()` re-requests when it changes, before
   the session's first sync.

## Writing back to Health

Opt-in, off by default, behind a single toggle in sync settings: `HealthWriter.swift`
writes **logged food only** — calories and macros and micros — so other apps can read
what you logged in Fuel. It never writes entries whose source is Health itself (that
would loop), skips zero and nil values, and records a written id only after
`store.save` succeeds. Choline is omitted because HealthKit has no type for it.

Whether to extend write-back beyond food was never decided.

## The Health Logger app

`ios/HealthLogger` is a separate Xcode project that predates Fuel reading HealthKit
itself. The app is vestigial, but **six of its source files are compiled into Fuel by
relative path** (`SyncEngine.swift`, `HealthKitCatalog.swift`, `SyncStore.swift`,
`SyncSink.swift`, `FuelAPI.swift`, `BackgroundSync.swift`) — genuinely shared, not
copied.

**A sync fix belongs in exactly one place.** After editing any of them, build both
projects.

It can still sync to any server implementing the protocol above (`SyncSink.swift` is the
seam), or export the whole history to NDJSON — one replayable batch per line:

```bash
while read -r line; do
  curl -s -X POST "$ENDPOINT" -H 'content-type: application/json' -d "$line"
done < health-export-*.ndjson
```

Export deliberately ignores the anchors in both directions: it always reads everything
and never advances them, so exporting cannot make the app think Fuel received data that
only went to a file.

## Adding a metric

1. Add it to `SyncEngine.extraMetrics` — identifier, statistic option, unit.
2. Add a line to `HealthExtras.all` — key, label, unit, which card it belongs on.
3. Ship. It flows into `extras` with no server change and no migration.

The read-set fingerprint changes automatically, so the app will re-request authorization
on first launch of the new build.
