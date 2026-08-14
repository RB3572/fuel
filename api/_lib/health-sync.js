import { sql, userForSyncToken } from './db.js'
import { methodNotAllowed, sendJson } from './http.js'

// /api/health/sync/v1 — the replication endpoint for the Health Logger iOS app.
//
// This replaces the Apple Shortcut pipeline's philosophy, not just its transport. The
// Shortcut POSTed one lossy daily summary and the parser existed to cope with however
// Shortcuts felt like formatting it that day. The app speaks a versioned protocol and
// syncs the raw HealthKit store — every sample, keyed by its HealthKit UUID — so the
// raw data becomes the source of truth and health_daily becomes a derived cache.
//
// Shape of a POST (see HEALTH_SYNC.md for the full contract):
//   {
//     syncVersion: 1,
//     fullSync: false,
//     batch: { index: 0, count: 4 },
//     device: { model, iosVersion, timezone, lastSync },
//     anchors: { stepCount: "<base64 HKQueryAnchor>", ... },
//     tables: {
//       dailyTotals:      [{ date, partialDay, activeEnergy, ... }],
//       quantitySamples:  [{ uuid, type, value, unit, start, end, source, device, metadata }],
//       categorySamples:  [{ uuid, type, value, start, end, source, device, metadata }],
//       heartRateSamples: [...],   // convenience aliases; normalized into the two above
//       sleepSamples:     [...],
//       workoutSamples:   [{ uuid, activityType, start, end, duration, activeEnergy, distance, elevation, averageHeartRate, route, metadata }],
//       clinicalRecords:  [{ uuid, type, fhir }],
//     },
//     deleted: { quantitySamples: [uuid], categorySamples: [uuid], workouts: [uuid] },
//     snapshot: { activeEnergy, restingEnergy, totalExpenditure },   // today, running totals
//   }
//
// Design rules this file enforces:
//   - Idempotent: every sample upserts on (user_id, hk_uuid). Replaying a batch after a
//     dropped response changes nothing. Deletions come from the same anchored queries.
//   - One round trip per table per request: rows travel as a jsonb array and unpack
//     inside Postgres, so a 5,000-sample batch is a handful of statements, not 5,000.
//   - Aggregates are computed ON DEVICE (HKStatisticsQuery deduplicates overlapping
//     sources — watch + phone — correctly; summing raw samples server-side does not)
//     and land in health_daily exactly where the legacy Shortcut wrote, so the web app
//     needs no changes and both pipelines can run during migration.
//   - Anchors are mirrored server-side so a reinstalled app can resume incrementally
//     instead of re-uploading years of history.
//   - Adding a HealthKit type needs no protocol change: new types flow through
//     quantitySamples/categorySamples untouched; only a query on the app side.

export const SYNC_VERSION = 1
// Per-request ceiling across all tables. The app batches under this; a request over it
// is refused with guidance rather than half-imported.
export const MAX_SAMPLES_PER_REQUEST = 20000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// How long individual HealthKit samples are kept. A watch writes a heart-rate sample
// every few seconds, so this table grows without bound and is what pushed the database
// past its storage limit — at which point every sync failed with "could not extend
// file" and no health data landed at all.
//
// Only the *raw* per-sample rows expire. health_daily (the per-day aggregates the
// dashboard, trends and history all actually read) is never pruned, so nothing a user
// can see gets shorter — the aggregates are computed on device and written directly,
// not derived from these rows. hk_workouts is also kept: one row per workout is not a
// volume problem, and it carries GPS routes that cannot be recomputed.
export const RAW_SAMPLE_RETENTION_DAYS = 7
// Deleted in bounded batches so the first prune after a long backlog can't build one
// enormous transaction (slow, and a lot of WAL on a database that is already full).
// Whatever a request doesn't finish, the next sync picks up.
const PRUNE_BATCH_SIZE = 20000
const PRUNE_MAX_BATCHES = 4

let schemaReady = null
export function ensureHealthSyncSchema() {
  if (!schemaReady) schemaReady = migrate().catch((error) => { schemaReady = null; throw error })
  return schemaReady
}

async function migrate() {
  const db = sql()
  // Raw quantity samples: steps, heart rate, weight, blood oxygen, walking speed —
  // anything HealthKit expresses as (value, unit, interval).
  await db`
    CREATE TABLE IF NOT EXISTS hk_quantity_samples (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      hk_uuid uuid NOT NULL,
      type text NOT NULL,
      value double precision NOT NULL,
      unit text,
      start_at timestamptz NOT NULL,
      end_at timestamptz NOT NULL,
      source text,
      device text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, hk_uuid)
    )
  `
  await db`CREATE INDEX IF NOT EXISTS hk_quantity_user_type_time ON hk_quantity_samples (user_id, type, start_at DESC)`
  // Category samples: sleep stages, stand hours, mindfulness minutes, symptoms.
  await db`
    CREATE TABLE IF NOT EXISTS hk_category_samples (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      hk_uuid uuid NOT NULL,
      type text NOT NULL,
      value integer NOT NULL,
      value_name text,
      start_at timestamptz NOT NULL,
      end_at timestamptz NOT NULL,
      source text,
      device text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, hk_uuid)
    )
  `
  await db`CREATE INDEX IF NOT EXISTS hk_category_user_type_time ON hk_category_samples (user_id, type, start_at DESC)`
  await db`
    CREATE TABLE IF NOT EXISTS hk_workouts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      hk_uuid uuid NOT NULL,
      activity_type text NOT NULL,
      start_at timestamptz NOT NULL,
      end_at timestamptz NOT NULL,
      duration_s double precision,
      active_kcal double precision,
      distance_m double precision,
      elevation_m double precision,
      average_heart_rate_bpm double precision,
      source text,
      device text,
      -- Simplified route: [[lat, lon, unixSeconds, altitudeM], ...] when granted.
      route jsonb,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, hk_uuid)
    )
  `
  await db`CREATE INDEX IF NOT EXISTS hk_workouts_user_time ON hk_workouts (user_id, start_at DESC)`
  await db`
    CREATE TABLE IF NOT EXISTS hk_clinical_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      hk_uuid uuid NOT NULL,
      type text NOT NULL,
      fhir jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, hk_uuid)
    )
  `
  // One row per sync request, for observability and debugging a stuck device.
  await db`
    CREATE TABLE IF NOT EXISTS health_sync_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      sync_version integer NOT NULL,
      full_sync boolean NOT NULL DEFAULT false,
      batch_index integer,
      batch_count integer,
      samples integer NOT NULL DEFAULT 0,
      device jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `
  await db`CREATE INDEX IF NOT EXISTS health_sync_sessions_user_time ON health_sync_sessions (user_id, created_at DESC)`
  // Server-side mirror of the app's HKQueryAnchors. The app owns them; this copy lets
  // a reinstall resume incrementally instead of re-uploading years of history.
  await db`
    CREATE TABLE IF NOT EXISTS health_sync_anchors (
      user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      data_type text NOT NULL,
      anchor text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, data_type)
    )
  `
  // The intraday snapshot table has existed as a reader forever; the app is its first
  // writer, which turns on the intraday chart and the measured rolling-24h path.
  await db`
    CREATE TABLE IF NOT EXISTS health_energy_snapshots (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      date date NOT NULL,
      collected_at timestamptz NOT NULL DEFAULT now(),
      active_energy_kcal double precision,
      resting_energy_kcal double precision,
      total_expenditure_kcal double precision
    )
  `
  await db`CREATE INDEX IF NOT EXISTS health_energy_snapshots_user_date ON health_energy_snapshots (user_id, date, collected_at DESC)`
}

export async function handleHealthSyncV1(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    methodNotAllowed(res, ['GET', 'POST'])
    return
  }
  res.setHeader('Cache-Control', 'no-store')

  // Same bearer-token model as the Shortcut: no Google login, no session, no OAuth.
  const authorization = String(req.headers.authorization || '')
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  const user = await userForSyncToken(token).catch(() => null)
  if (!user) {
    sendJson(res, 401, { error: 'A valid Fuel health sync bearer token is required.' })
    return
  }

  try {
    await ensureHealthSyncSchema()
    if (req.method === 'GET') {
      sendJson(res, 200, await syncState(user.id))
      return
    }
    const body = parseBody(req.body)
    const version = Number(body?.syncVersion)
    if (version !== SYNC_VERSION) {
      sendJson(res, 400, { error: `Unsupported syncVersion ${body?.syncVersion ?? '(missing)'}; this server speaks version ${SYNC_VERSION}.`, syncVersion: SYNC_VERSION })
      return
    }
    const result = await ingest(user.id, body)
    sendJson(res, result.statusCode, result.body)
  } catch (error) {
    console.error('Health sync failed', error)
    sendJson(res, 500, { error: 'Health data could not be stored.' })
  }
}

/// Drops per-sample rows past the retention window, oldest first, in bounded batches.
/// Returns how many rows went, per table.
///
/// Batching is by ctid rather than a plain predicate delete because the first prune
/// after a long backlog can match millions of rows: one statement would hold a single
/// long transaction and write all of its WAL at once. Each request does a little and
/// returns; syncs are frequent enough that the backlog drains quickly.
async function pruneExpiredSamples(db, userId) {
  const pruned = { quantitySamples: 0, categorySamples: 0, energySnapshots: 0, syncSessions: 0 }
  const cutoff = `${RAW_SAMPLE_RETENTION_DAYS} days`

  // Each statement returns a single count rather than a row per deleted row — at this
  // batch size RETURNING would put tens of thousands of rows on the wire per sync for
  // a number nobody reads except this log line.
  for (let batch = 0; batch < PRUNE_MAX_BATCHES; batch += 1) {
    const [{ n }] = await db`
      WITH gone AS (
        DELETE FROM hk_quantity_samples WHERE ctid IN (
          SELECT ctid FROM hk_quantity_samples
          WHERE user_id = ${userId} AND start_at < now() - ${cutoff}::interval
          LIMIT ${PRUNE_BATCH_SIZE}
        ) RETURNING 1
      ) SELECT count(*)::int AS n FROM gone
    `
    pruned.quantitySamples += n
    if (n < PRUNE_BATCH_SIZE) break
  }

  for (let batch = 0; batch < PRUNE_MAX_BATCHES; batch += 1) {
    const [{ n }] = await db`
      WITH gone AS (
        DELETE FROM hk_category_samples WHERE ctid IN (
          SELECT ctid FROM hk_category_samples
          WHERE user_id = ${userId} AND start_at < now() - ${cutoff}::interval
          LIMIT ${PRUNE_BATCH_SIZE}
        ) RETURNING 1
      ) SELECT count(*)::int AS n FROM gone
    `
    pruned.categorySamples += n
    if (n < PRUNE_BATCH_SIZE) break
  }

  // Intraday snapshots back only today's chart and the rolling-24h figure, so anything
  // past the window is already unreadable by the UI.
  const [{ n: snapshots }] = await db`
    WITH gone AS (
      DELETE FROM health_energy_snapshots
      WHERE user_id = ${userId} AND collected_at < now() - ${cutoff}::interval
      RETURNING 1
    ) SELECT count(*)::int AS n FROM gone
  `
  pruned.energySnapshots = snapshots

  // One row per sync request, kept purely for debugging a stuck device — a background
  // sync every few minutes makes this one of the fastest-growing tables in the schema.
  const [{ n: sessions }] = await db`
    WITH gone AS (
      DELETE FROM health_sync_sessions
      WHERE user_id = ${userId} AND created_at < now() - ${cutoff}::interval
      RETURNING 1
    ) SELECT count(*)::int AS n FROM gone
  `
  pruned.syncSessions = sessions

  return pruned
}

// What a (re)installed app needs to resume: its anchors and the last thing the server
// heard from any device.
async function syncState(userId) {
  const db = sql()
  const [anchors, sessions] = await Promise.all([
    db`SELECT data_type, anchor, updated_at FROM health_sync_anchors WHERE user_id = ${userId}`,
    db`SELECT sync_version, full_sync, samples, device, created_at FROM health_sync_sessions WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 1`,
  ])
  return {
    syncVersion: SYNC_VERSION,
    maxSamplesPerRequest: MAX_SAMPLES_PER_REQUEST,
    anchors: Object.fromEntries(anchors.map((row) => [row.data_type, row.anchor])),
    lastSession: sessions[0] ? { at: sessions[0].created_at, samples: sessions[0].samples, fullSync: sessions[0].full_sync, device: sessions[0].device } : null,
    serverTime: new Date().toISOString(),
  }
}

async function ingest(userId, body) {
  const tables = body?.tables && typeof body.tables === 'object' ? body.tables : {}
  const deleted = body?.deleted && typeof body.deleted === 'object' ? body.deleted : {}

  // The convenience aliases are exactly what they claim to be underneath: heart rate is
  // a quantity type and sleep is a category type. Normalizing here keeps the storage
  // model at two tables while the payload stays organized the way the spec reads.
  const quantity = [
    ...asArray(tables.quantitySamples),
    ...asArray(tables.heartRateSamples).map((sample) => ({ type: 'heartRate', unit: 'count/min', ...sample })),
  ]
  const category = [
    ...asArray(tables.categorySamples),
    ...asArray(tables.sleepSamples).map((sample) => ({ type: 'sleepAnalysis', ...sample })),
  ]
  const workouts = asArray(tables.workoutSamples)
  const clinical = asArray(tables.clinicalRecords)
  const dailyTotals = asArray(tables.dailyTotals)

  const total = quantity.length + category.length + workouts.length + clinical.length
  if (total > MAX_SAMPLES_PER_REQUEST) {
    return { statusCode: 413, body: { error: `This request carries ${total} samples; the limit is ${MAX_SAMPLES_PER_REQUEST} per request. Split into smaller batches.`, maxSamplesPerRequest: MAX_SAMPLES_PER_REQUEST } }
  }

  const db = sql()
  const report = { quantitySamples: 0, categorySamples: 0, workouts: 0, clinicalRecords: 0, dailyTotals: 0, deleted: 0, skipped: [] }

  // Runs before the inserts, not after: on a database that has already hit its storage
  // limit the insert is exactly what fails, so reclaiming first is what lets this
  // request succeed rather than being the cleanup that never gets reached.
  // Non-fatal: a prune that fails should not turn a sync that would otherwise land into
  // a 500. The insert below reports the real problem if there genuinely is no room.
  try {
    report.pruned = await pruneExpiredSamples(db, userId)
  } catch (error) {
    console.error('Health sample prune failed', error)
  }

  // ---- Raw samples: one jsonb round trip per table -------------------------------
  const cleanQuantity = quantity.map(normalizeQuantity).filter((row) => keep(row, report, 'quantitySamples'))
  if (cleanQuantity.length) {
    const rows = await db`
      INSERT INTO hk_quantity_samples (user_id, hk_uuid, type, value, unit, start_at, end_at, source, device, metadata)
      SELECT ${userId}, (x->>'uuid')::uuid, x->>'type', (x->>'value')::double precision, x->>'unit',
             (x->>'start')::timestamptz, (x->>'end')::timestamptz, x->>'source', x->>'device',
             coalesce(nullif(x->'metadata', 'null'::jsonb), '{}'::jsonb)
      FROM jsonb_array_elements(${JSON.stringify(cleanQuantity)}::jsonb) AS x
      ON CONFLICT (user_id, hk_uuid) DO UPDATE SET
        value = EXCLUDED.value, unit = EXCLUDED.unit, end_at = EXCLUDED.end_at, metadata = EXCLUDED.metadata
      RETURNING id
    `
    report.quantitySamples = rows.length
  }

  const cleanCategory = category.map(normalizeCategory).filter((row) => keep(row, report, 'categorySamples'))
  if (cleanCategory.length) {
    const rows = await db`
      INSERT INTO hk_category_samples (user_id, hk_uuid, type, value, value_name, start_at, end_at, source, device, metadata)
      SELECT ${userId}, (x->>'uuid')::uuid, x->>'type', (x->>'value')::integer, x->>'valueName',
             (x->>'start')::timestamptz, (x->>'end')::timestamptz, x->>'source', x->>'device',
             coalesce(nullif(x->'metadata', 'null'::jsonb), '{}'::jsonb)
      FROM jsonb_array_elements(${JSON.stringify(cleanCategory)}::jsonb) AS x
      ON CONFLICT (user_id, hk_uuid) DO UPDATE SET
        value = EXCLUDED.value, value_name = EXCLUDED.value_name, end_at = EXCLUDED.end_at, metadata = EXCLUDED.metadata
      RETURNING id
    `
    report.categorySamples = rows.length
  }

  const cleanWorkouts = workouts.map(normalizeWorkout).filter((row) => keep(row, report, 'workouts'))
  if (cleanWorkouts.length) {
    const rows = await db`
      INSERT INTO hk_workouts (user_id, hk_uuid, activity_type, start_at, end_at, duration_s, active_kcal,
                               distance_m, elevation_m, average_heart_rate_bpm, source, device, route, metadata)
      SELECT ${userId}, (x->>'uuid')::uuid, x->>'activityType', (x->>'start')::timestamptz, (x->>'end')::timestamptz,
             (x->>'duration')::double precision, (x->>'activeEnergy')::double precision,
             (x->>'distance')::double precision, (x->>'elevation')::double precision,
             (x->>'averageHeartRate')::double precision, x->>'source', x->>'device',
             nullif(x->'route', 'null'::jsonb), coalesce(nullif(x->'metadata', 'null'::jsonb), '{}'::jsonb)
      FROM jsonb_array_elements(${JSON.stringify(cleanWorkouts)}::jsonb) AS x
      ON CONFLICT (user_id, hk_uuid) DO UPDATE SET
        activity_type = EXCLUDED.activity_type, end_at = EXCLUDED.end_at, duration_s = EXCLUDED.duration_s,
        active_kcal = EXCLUDED.active_kcal, distance_m = EXCLUDED.distance_m, elevation_m = EXCLUDED.elevation_m,
        average_heart_rate_bpm = EXCLUDED.average_heart_rate_bpm,
        route = COALESCE(EXCLUDED.route, hk_workouts.route), metadata = EXCLUDED.metadata
      RETURNING id
    `
    report.workouts = rows.length
  }

  const cleanClinical = clinical.map(normalizeClinical).filter((row) => keep(row, report, 'clinicalRecords'))
  if (cleanClinical.length) {
    const rows = await db`
      INSERT INTO hk_clinical_records (user_id, hk_uuid, type, fhir)
      SELECT ${userId}, (x->>'uuid')::uuid, x->>'type', coalesce(nullif(x->'fhir', 'null'::jsonb), '{}'::jsonb)
      FROM jsonb_array_elements(${JSON.stringify(cleanClinical)}::jsonb) AS x
      ON CONFLICT (user_id, hk_uuid) DO UPDATE SET type = EXCLUDED.type, fhir = EXCLUDED.fhir
      RETURNING id
    `
    report.clinicalRecords = rows.length
  }

  // ---- Deletions: anchored queries report these alongside additions ----------------
  for (const [table, column] of [['quantitySamples', 'hk_quantity_samples'], ['categorySamples', 'hk_category_samples'], ['workouts', 'hk_workouts']]) {
    const uuids = asArray(deleted[table]).filter((value) => UUID_RE.test(String(value)))
    if (!uuids.length) continue
    const rows = column === 'hk_quantity_samples'
      ? await db`DELETE FROM hk_quantity_samples WHERE user_id = ${userId} AND hk_uuid = ANY(SELECT (x#>>'{}')::uuid FROM jsonb_array_elements(${JSON.stringify(uuids)}::jsonb) AS x) RETURNING id`
      : column === 'hk_category_samples'
        ? await db`DELETE FROM hk_category_samples WHERE user_id = ${userId} AND hk_uuid = ANY(SELECT (x#>>'{}')::uuid FROM jsonb_array_elements(${JSON.stringify(uuids)}::jsonb) AS x) RETURNING id`
        : await db`DELETE FROM hk_workouts WHERE user_id = ${userId} AND hk_uuid = ANY(SELECT (x#>>'{}')::uuid FROM jsonb_array_elements(${JSON.stringify(uuids)}::jsonb) AS x) RETURNING id`
    report.deleted += rows.length
  }

  // ---- Daily aggregates -> health_daily (the derived cache) -----------------------
  // Same columns the Shortcut wrote, so the dashboard, trends, vitals and MCP all work
  // unchanged, and both pipelines can coexist during migration.
  if (dailyTotals.length) await ensureExtrasColumn()
  for (const raw of dailyTotals) {
    const day = normalizeDailyTotal(raw)
    if (!day) { report.skipped.push({ table: 'dailyTotals', reason: 'invalid date', row: String(raw?.date ?? '') }); continue }
    await db`
      INSERT INTO health_daily (
        user_id, date, active_energy_kcal, resting_energy_kcal, total_expenditure_kcal,
        exercise_minutes, step_count, walking_running_distance_mi, swimming_distance_yd,
        resting_heart_rate_bpm, hrv_ms, vo2_max, sleep_hours, respiratory_rate,
        blood_oxygen_percent, stand_minutes, walking_heart_rate_avg_bpm,
        cycling_distance_mi, flights_climbed, swimming_strokes,
        running_stride_length_m, cardio_recovery_bpm, extras, partial_day, source, raw_payload, updated_at
      ) VALUES (
        ${userId}, ${day.date}::date, ${day.activeEnergy}, ${day.restingEnergy}, ${day.totalExpenditure},
        ${day.exerciseMinutes}, ${day.steps}, ${day.walkingRunningDistance}, ${day.swimmingDistance},
        ${day.restingHeartRate}, ${day.hrv}, ${day.vo2Max}, ${day.sleepHours}, ${day.respiratoryRate},
        ${day.bloodOxygen}, ${day.standMinutes}, ${day.walkingHeartRateAverage},
        ${day.cyclingDistance}, ${day.flightsClimbed}, ${day.swimmingStrokes},
        ${day.runningStrideLength}, ${day.cardioRecovery}, ${JSON.stringify(day.extras)}::jsonb,
        ${day.partialDay}, 'Health Logger', ${JSON.stringify(raw)}, now()
      )
      ON CONFLICT (user_id, date) DO UPDATE SET
        active_energy_kcal = COALESCE(EXCLUDED.active_energy_kcal, health_daily.active_energy_kcal),
        resting_energy_kcal = COALESCE(EXCLUDED.resting_energy_kcal, health_daily.resting_energy_kcal),
        total_expenditure_kcal = COALESCE(EXCLUDED.total_expenditure_kcal, health_daily.total_expenditure_kcal),
        exercise_minutes = COALESCE(EXCLUDED.exercise_minutes, health_daily.exercise_minutes),
        step_count = COALESCE(EXCLUDED.step_count, health_daily.step_count),
        walking_running_distance_mi = COALESCE(EXCLUDED.walking_running_distance_mi, health_daily.walking_running_distance_mi),
        swimming_distance_yd = COALESCE(EXCLUDED.swimming_distance_yd, health_daily.swimming_distance_yd),
        resting_heart_rate_bpm = COALESCE(EXCLUDED.resting_heart_rate_bpm, health_daily.resting_heart_rate_bpm),
        hrv_ms = COALESCE(EXCLUDED.hrv_ms, health_daily.hrv_ms),
        vo2_max = COALESCE(EXCLUDED.vo2_max, health_daily.vo2_max),
        sleep_hours = COALESCE(EXCLUDED.sleep_hours, health_daily.sleep_hours),
        respiratory_rate = COALESCE(EXCLUDED.respiratory_rate, health_daily.respiratory_rate),
        blood_oxygen_percent = COALESCE(EXCLUDED.blood_oxygen_percent, health_daily.blood_oxygen_percent),
        stand_minutes = COALESCE(EXCLUDED.stand_minutes, health_daily.stand_minutes),
        walking_heart_rate_avg_bpm = COALESCE(EXCLUDED.walking_heart_rate_avg_bpm, health_daily.walking_heart_rate_avg_bpm),
        cycling_distance_mi = COALESCE(EXCLUDED.cycling_distance_mi, health_daily.cycling_distance_mi),
        flights_climbed = COALESCE(EXCLUDED.flights_climbed, health_daily.flights_climbed),
        swimming_strokes = COALESCE(EXCLUDED.swimming_strokes, health_daily.swimming_strokes),
        running_stride_length_m = COALESCE(EXCLUDED.running_stride_length_m, health_daily.running_stride_length_m),
        cardio_recovery_bpm = COALESCE(EXCLUDED.cardio_recovery_bpm, health_daily.cardio_recovery_bpm),
        -- Merged, not replaced: a sync that only had a couple of these must not wipe
        -- what an earlier one already recorded for the same day.
        extras = COALESCE(health_daily.extras, '{}'::jsonb) || COALESCE(EXCLUDED.extras, '{}'::jsonb),
        partial_day = EXCLUDED.partial_day,
        source = EXCLUDED.source,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = now()
    `
    report.dailyTotals += 1
  }

  // ---- Intraday snapshot ----------------------------------------------------------
  // A running within-day total. Written every sync, it feeds the intraday energy chart
  // and the rolling-24h "measured" path — the two features that have been silently
  // degraded because nothing ever wrote this table.
  const snapshot = body?.snapshot
  if (snapshot && typeof snapshot === 'object') {
    const active = finite(snapshot.activeEnergy)
    const resting = finite(snapshot.restingEnergy)
    const total = finite(snapshot.totalExpenditure) ?? (active != null && resting != null ? active + resting : null)
    const date = normalizeDate(snapshot.date) || localDate(body?.device?.timezone)
    if (total != null || active != null || resting != null) {
      // Snapshots are an append-only series, which would make a replayed batch the one
      // request that leaves a trace. Skip the insert when the previous snapshot for the
      // day already carries these exact totals — a retry after a dropped response then
      // changes nothing anywhere.
      const last = await db`
        SELECT active_energy_kcal, resting_energy_kcal, total_expenditure_kcal
        FROM health_energy_snapshots WHERE user_id = ${userId} AND date = ${date}::date
        ORDER BY collected_at DESC LIMIT 1
      `
      const same = last.length
        && Number(last[0].active_energy_kcal) === Number(active)
        && Number(last[0].resting_energy_kcal) === Number(resting)
        && Number(last[0].total_expenditure_kcal) === Number(total)
      if (!same) {
        await db`
          INSERT INTO health_energy_snapshots (user_id, date, active_energy_kcal, resting_energy_kcal, total_expenditure_kcal)
          VALUES (${userId}, ${date}::date, ${active}, ${resting}, ${total})
        `
      }
    }
  }

  // ---- Anchors + session ----------------------------------------------------------
  const anchors = body?.anchors && typeof body.anchors === 'object' ? body.anchors : {}
  for (const [dataType, anchor] of Object.entries(anchors)) {
    const clean = String(anchor || '').slice(0, 4096)
    if (!clean || String(dataType).length > 120) continue
    await db`
      INSERT INTO health_sync_anchors (user_id, data_type, anchor, updated_at)
      VALUES (${userId}, ${String(dataType)}, ${clean}, now())
      ON CONFLICT (user_id, data_type) DO UPDATE SET anchor = EXCLUDED.anchor, updated_at = now()
    `
  }

  const batch = body?.batch && typeof body.batch === 'object' ? body.batch : {}
  await db`
    INSERT INTO health_sync_sessions (user_id, sync_version, full_sync, batch_index, batch_count, samples, device)
    VALUES (${userId}, ${SYNC_VERSION}, ${body?.fullSync === true}, ${integer(batch.index)}, ${integer(batch.count)}, ${total}, ${JSON.stringify(body?.device && typeof body.device === 'object' ? body.device : {})})
  `

  return { statusCode: 200, body: { ok: true, syncVersion: SYNC_VERSION, stored: report, maxSamplesPerRequest: MAX_SAMPLES_PER_REQUEST } }
}

// ---- Normalizers -------------------------------------------------------------------

function normalizeQuantity(sample) {
  const uuid = String(sample?.uuid || '').toLowerCase()
  const value = finite(sample?.value)
  const start = timestamp(sample?.start)
  const end = timestamp(sample?.end) || start
  const type = trimmed(sample?.type, 120)
  if (!UUID_RE.test(uuid) || value == null || !start || !type) return { invalid: describeInvalid(sample, { uuid, value, start, type }) }
  return {
    uuid, type, value,
    unit: trimmed(sample?.unit, 40),
    start, end,
    source: trimmed(sample?.source, 200),
    device: trimmed(sample?.device, 200),
    metadata: plainObject(sample?.metadata),
  }
}

function normalizeCategory(sample) {
  const uuid = String(sample?.uuid || '').toLowerCase()
  const value = integer(sample?.value)
  const start = timestamp(sample?.start)
  const end = timestamp(sample?.end) || start
  const type = trimmed(sample?.type, 120)
  if (!UUID_RE.test(uuid) || value == null || !start || !type) return { invalid: describeInvalid(sample, { uuid, value, start, type }) }
  return {
    uuid, type, value,
    valueName: trimmed(sample?.valueName, 60),
    start, end,
    source: trimmed(sample?.source, 200),
    device: trimmed(sample?.device, 200),
    metadata: plainObject(sample?.metadata),
  }
}

function normalizeWorkout(workout) {
  const uuid = String(workout?.uuid || '').toLowerCase()
  const start = timestamp(workout?.start)
  const end = timestamp(workout?.end) || start
  const activityType = trimmed(workout?.activityType, 120)
  if (!UUID_RE.test(uuid) || !start || !activityType) return { invalid: describeInvalid(workout, { uuid, start, activityType }) }
  // Routes are capped: a multi-hour ride at 1 Hz is tens of thousands of points, and
  // the map drawn from them does not need more than a few thousand.
  const route = Array.isArray(workout?.route)
    ? workout.route.slice(0, 4000).filter((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
    : null
  return {
    uuid, activityType, start, end,
    duration: finite(workout?.duration),
    activeEnergy: finite(workout?.activeEnergy),
    distance: finite(workout?.distance),
    elevation: finite(workout?.elevation),
    averageHeartRate: finite(workout?.averageHeartRate),
    source: trimmed(workout?.source, 200),
    device: trimmed(workout?.device, 200),
    route: route && route.length ? route : null,
    metadata: plainObject(workout?.metadata),
  }
}

function normalizeClinical(record) {
  const uuid = String(record?.uuid || '').toLowerCase()
  const type = trimmed(record?.type, 120)
  if (!UUID_RE.test(uuid) || !type) return { invalid: describeInvalid(record, { uuid, type }) }
  return { uuid, type, fhir: plainObject(record?.fhir) }
}

/// Numbers only, and only ones that are actually finite — a NaN from a device with a
/// flat battery must not become a stored reading.
let extrasColumnReady = null
/// Added after health_daily shipped, so existing databases need it in place before the
/// first write that mentions it. Memoized: one ALTER per process, not per sync.
function ensureExtrasColumn() {
  if (!extrasColumnReady) {
    extrasColumnReady = sql()`ALTER TABLE health_daily ADD COLUMN IF NOT EXISTS extras jsonb`
      .catch((error) => { extrasColumnReady = null; throw error })
  }
  return extrasColumnReady
}

function normalizeExtras(raw) {
  if (!raw || typeof raw !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    const number = finite(value)
    if (number != null && /^[A-Za-z0-9]+$/.test(key)) out[key] = number
  }
  return out
}

function normalizeDailyTotal(raw) {
  const date = normalizeDate(raw?.date)
  if (!date) return null
  const activeEnergy = finite(raw?.activeEnergy)
  const restingEnergy = finite(raw?.restingEnergy)
  return {
    date,
    activeEnergy,
    restingEnergy,
    totalExpenditure: finite(raw?.totalExpenditure) ?? (activeEnergy != null && restingEnergy != null ? activeEnergy + restingEnergy : null),
    exerciseMinutes: finite(raw?.exerciseMinutes),
    steps: finite(raw?.steps),
    walkingRunningDistance: finite(raw?.walkingRunningDistanceMi ?? raw?.walkingRunningDistance),
    swimmingDistance: finite(raw?.swimmingDistanceYd ?? raw?.swimmingDistance),
    restingHeartRate: finite(raw?.restingHeartRate),
    hrv: finite(raw?.hrv),
    vo2Max: finite(raw?.vo2Max),
    sleepHours: finite(raw?.sleepHours),
    respiratoryRate: finite(raw?.respiratoryRate),
    bloodOxygen: finite(raw?.bloodOxygen),
    standMinutes: finite(raw?.standMinutes),
    walkingHeartRateAverage: finite(raw?.walkingHeartRateAverage),
    cyclingDistance: finite(raw?.cyclingDistanceMi ?? raw?.cyclingDistance),
    flightsClimbed: finite(raw?.flightsClimbed),
    swimmingStrokes: finite(raw?.swimmingStrokes),
    runningStrideLength: finite(raw?.runningStrideLength),
    cardioRecovery: finite(raw?.cardioRecovery),
    // Everything added after the original eighteen, one number per day each. Kept as
    // one jsonb value rather than a column apiece: they are summaries, the set keeps
    // growing, and a day with none of them costs nothing.
    extras: normalizeExtras(raw?.extras),
    partialDay: raw?.partialDay === true,
  }
}

// ---- Small helpers -----------------------------------------------------------------

function keep(row, report, table) {
  if (!row.invalid) return true
  // Skipped rows are named in the response, never silently dropped: a malformed batch
  // from a future app version should be visible on the first sync, not months later.
  if (report.skipped.length < 50) report.skipped.push({ table, reason: row.invalid })
  return false
}

function describeInvalid(sample, fields) {
  const missing = Object.entries(fields).filter(([, v]) => v == null || v === '' || v === false).map(([k]) => k)
  return `missing/invalid ${missing.join(', ')} (uuid ${String(sample?.uuid ?? 'none').slice(0, 40)})`
}

function asArray(value) { return Array.isArray(value) ? value : [] }
function plainObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {} }
function trimmed(value, max) {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, max) : null
}
function finite(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
function integer(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : null
}
function timestamp(value) {
  if (!value) return null
  // Accept ISO strings or unix seconds.
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}
function normalizeDate(value) {
  const text = String(value || '')
  return /^20\d{2}-\d{2}-\d{2}$/.test(text) ? text : null
}
function localDate(timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: String(timezone || 'America/Los_Angeles') }).format(new Date())
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
  }
}
function parseBody(body) {
  if (Buffer.isBuffer(body)) return JSON.parse(body.toString('utf8'))
  if (typeof body === 'string') return JSON.parse(body)
  return body && typeof body === 'object' ? body : {}
}
