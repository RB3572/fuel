import { sql } from './db.js'

// Location history for the 24-hour place heatmap.
//
// Samples are captured when the app loads and clustered into "places" by proximity,
// so the heatmap can answer "when am I usually home / at work / out". This is the most
// sensitive data Fuel stores, so it stays in the user's own database, is scoped by
// user_id on every read, and can be deleted wholesale from the Places tab.

const TIME_ZONE = 'America/Los_Angeles'
// Two samples within this distance are treated as the same place. 150 m is wide
// enough to absorb GPS drift indoors but tight enough to separate neighbouring
// buildings.
const CLUSTER_RADIUS_M = 150
// Half-hour resolution: fine enough to see a commute, coarse enough to stay readable.
const BUCKETS_PER_DAY = 48
const MINUTES_PER_BUCKET = (24 * 60) / BUCKETS_PER_DAY
// Ignore fixes so imprecise they could land in the wrong cluster.
const MAX_ACCURACY_M = 500
// A single page load can fire more than once; never store two fixes this close apart.
const MIN_SAMPLE_GAP_SECONDS = 120
// Keep the legend readable; rarer places collapse into "Elsewhere" in the UI.
const MAX_PLACES = 40

let schemaReady = null
export function ensurePlacesSchema() {
  if (!schemaReady) schemaReady = migrate().catch((error) => { schemaReady = null; throw error })
  return schemaReady
}

async function migrate() {
  const db = sql()
  await db`
    CREATE TABLE IF NOT EXISTS user_places (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      label text,
      latitude double precision NOT NULL,
      longitude double precision NOT NULL,
      sample_count integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `
  await db`
    CREATE TABLE IF NOT EXISTS user_location_samples (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      place_id uuid REFERENCES user_places(id) ON DELETE CASCADE,
      recorded_at timestamptz NOT NULL DEFAULT now(),
      latitude double precision NOT NULL,
      longitude double precision NOT NULL,
      accuracy_m double precision
    )
  `
  await db`CREATE INDEX IF NOT EXISTS user_location_samples_user_time ON user_location_samples (user_id, recorded_at DESC)`
  await db`CREATE INDEX IF NOT EXISTS user_places_user ON user_places (user_id)`
}

// Records one fix and files it under the nearest known place, creating a place when
// the fix falls outside every existing cluster.
export async function recordLocation(userId, input) {
  await ensurePlacesSchema()
  const latitude = coord(input?.latitude, 90)
  const longitude = coord(input?.longitude, 180)
  if (latitude == null || longitude == null) throw new Error('A valid latitude and longitude are required.')
  const accuracy = Number.isFinite(Number(input?.accuracy)) ? Number(input.accuracy) : null
  if (accuracy != null && accuracy > MAX_ACCURACY_M) return { skipped: 'inaccurate' }

  const db = sql()
  const recent = await db`
    SELECT recorded_at FROM user_location_samples
    WHERE user_id = ${userId} AND recorded_at > now() - (${MIN_SAMPLE_GAP_SECONDS} * interval '1 second')
    LIMIT 1
  `
  if (recent.length) return { skipped: 'throttled' }

  const places = await db`SELECT id, latitude, longitude, sample_count FROM user_places WHERE user_id = ${userId}`
  let nearest = null
  let nearestDistance = Infinity
  for (const place of places) {
    const distance = metresBetween({ latitude, longitude }, place)
    if (distance < nearestDistance) { nearest = place; nearestDistance = distance }
  }

  let placeId
  if (nearest && nearestDistance <= CLUSTER_RADIUS_M) {
    // Nudge the centroid toward the new fix (running mean) so a place settles on its
    // true centre as samples accumulate.
    const count = Number(nearest.sample_count) || 0
    const nextLat = (Number(nearest.latitude) * count + latitude) / (count + 1)
    const nextLon = (Number(nearest.longitude) * count + longitude) / (count + 1)
    const updated = await db`
      UPDATE user_places
      SET latitude = ${nextLat}, longitude = ${nextLon}, sample_count = sample_count + 1, updated_at = now()
      WHERE id = ${nearest.id} AND user_id = ${userId}
      RETURNING id
    `
    placeId = updated[0]?.id || nearest.id
  } else if (places.length >= MAX_PLACES && nearest) {
    // Somewhere genuinely new, but the place list is full. File it under the closest
    // known place rather than growing the list without bound.
    const updated = await db`
      UPDATE user_places SET sample_count = sample_count + 1, updated_at = now()
      WHERE id = ${nearest.id} AND user_id = ${userId} RETURNING id
    `
    placeId = updated[0]?.id || nearest.id
  } else {
    const created = await db`
      INSERT INTO user_places (user_id, latitude, longitude, sample_count)
      VALUES (${userId}, ${latitude}, ${longitude}, 1)
      RETURNING id
    `
    placeId = created[0]?.id
  }

  await db`
    INSERT INTO user_location_samples (user_id, place_id, latitude, longitude, accuracy_m)
    VALUES (${userId}, ${placeId}, ${latitude}, ${longitude}, ${accuracy})
  `
  return { recorded: true, placeId }
}

// Aggregates samples into a 48-slot day: for each half hour, which place dominates and
// how consistently.
export async function getPlaceHeatmap(userId, days = 30) {
  await ensurePlacesSchema()
  const db = sql()
  const window = Math.min(365, Math.max(1, Number(days) || 30))

  const [places, rows, coverage] = await Promise.all([
    db`SELECT id, label, latitude, longitude, sample_count FROM user_places WHERE user_id = ${userId} ORDER BY sample_count DESC`,
    db`
      SELECT place_id,
        (EXTRACT(hour FROM recorded_at AT TIME ZONE ${TIME_ZONE})::int * 2
          + CASE WHEN EXTRACT(minute FROM recorded_at AT TIME ZONE ${TIME_ZONE}) >= 30 THEN 1 ELSE 0 END) AS bucket,
        count(*)::int AS samples
      FROM user_location_samples
      WHERE user_id = ${userId}
        AND place_id IS NOT NULL
        AND recorded_at >= now() - (${window} * interval '1 day')
      GROUP BY 1, 2
    `,
    db`
      SELECT count(*)::int AS samples,
        count(DISTINCT (recorded_at AT TIME ZONE ${TIME_ZONE})::date)::int AS days,
        min(recorded_at) AS first_at
      FROM user_location_samples
      WHERE user_id = ${userId} AND recorded_at >= now() - (${window} * interval '1 day')
    `,
  ])

  const totals = new Map()
  const byBucket = Array.from({ length: BUCKETS_PER_DAY }, () => ({ total: 0, counts: new Map() }))
  for (const row of rows) {
    const bucket = Number(row.bucket)
    if (!Number.isInteger(bucket) || bucket < 0 || bucket >= BUCKETS_PER_DAY) continue
    const samples = Number(row.samples) || 0
    const key = String(row.place_id)
    byBucket[bucket].total += samples
    byBucket[bucket].counts.set(key, (byBucket[bucket].counts.get(key) || 0) + samples)
    totals.set(key, (totals.get(key) || 0) + samples)
  }

  // "Likely home" = wherever the overnight hours are spent. A guess, surfaced as a
  // hint rather than an automatic rename.
  const overnight = new Map()
  for (let bucket = 2; bucket < 10; bucket += 1) { // 01:00–05:00 local
    for (const [key, count] of byBucket[bucket].counts) overnight.set(key, (overnight.get(key) || 0) + count)
  }
  let likelyHome = null
  let best = 0
  for (const [key, count] of overnight) if (count > best) { likelyHome = key; best = count }

  const orderedPlaces = places
    .map((place) => ({
      id: String(place.id),
      label: place.label || null,
      latitude: Number(place.latitude),
      longitude: Number(place.longitude),
      samples: totals.get(String(place.id)) || 0,
      likelyHome: String(place.id) === likelyHome,
    }))
    .sort((a, b) => b.samples - a.samples)

  const buckets = byBucket.map((bucket, index) => {
    let dominant = null
    let dominantCount = 0
    for (const [key, count] of bucket.counts) if (count > dominantCount) { dominant = key; dominantCount = count }
    return {
      index,
      startMinute: index * MINUTES_PER_BUCKET,
      placeId: dominant,
      samples: bucket.total,
      // How consistently that place wins this slot: 1 means always there.
      share: bucket.total ? dominantCount / bucket.total : 0,
    }
  })

  return {
    places: orderedPlaces,
    buckets,
    bucketsPerDay: BUCKETS_PER_DAY,
    windowDays: window,
    totalSamples: coverage[0]?.samples || 0,
    daysCovered: coverage[0]?.days || 0,
    firstSampleAt: coverage[0]?.first_at ? new Date(coverage[0].first_at).toISOString() : null,
  }
}

export async function renamePlace(userId, placeId, label) {
  await ensurePlacesSchema()
  const clean = String(label ?? '').trim().slice(0, 60)
  const db = sql()
  const rows = await db`
    UPDATE user_places SET label = ${clean || null}, updated_at = now()
    WHERE id = ${String(placeId)}::uuid AND user_id = ${userId}
    RETURNING id, label
  `
  if (!rows.length) throw new Error('That place was not found.')
  return { id: String(rows[0].id), label: rows[0].label || null }
}

// Deletes every stored fix and place for this user. Samples cascade from places, but
// both are cleared explicitly so nothing survives a partially-populated table.
export async function clearLocationHistory(userId) {
  await ensurePlacesSchema()
  const db = sql()
  const samples = await db`DELETE FROM user_location_samples WHERE user_id = ${userId} RETURNING id`
  const places = await db`DELETE FROM user_places WHERE user_id = ${userId} RETURNING id`
  return { deletedSamples: samples.length, deletedPlaces: places.length }
}

function coord(value, limit) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || Math.abs(parsed) > limit) return null
  return parsed
}

function metresBetween(a, b) {
  const R = 6371000
  const toRad = (deg) => (Number(deg) * Math.PI) / 180
  const lat1 = toRad(a.latitude)
  const lat2 = toRad(b.latitude)
  const dLat = lat2 - lat1
  const dLon = toRad(b.longitude) - toRad(a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
