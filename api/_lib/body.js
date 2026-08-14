import { sql } from './db.js'
import { databaseDateKey } from './neon-dashboard.js'

// Body measurements: the numbers a scale gives you, and the tape-measure ones it does
// not. One row per reading rather than one per day, because a smart scale can produce
// several in a morning and the spread between them is real information.
//
// BMI is deliberately not stored. It is weight and height arithmetic with no independent
// content, and storing a derived number means it can disagree with the two numbers it
// came from the moment either is corrected. It is computed for display instead.

const MEASUREMENT_LIMIT = 400

let schemaReady = null
export function ensureBodySchema() {
  if (!schemaReady) schemaReady = migrate().catch((error) => { schemaReady = null; throw error })
  return schemaReady
}

async function migrate() {
  const db = sql()
  await db`
    CREATE TABLE IF NOT EXISTS body_measurements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      recorded_at timestamptz NOT NULL DEFAULT now(),
      weight_lb double precision,
      body_fat_percent double precision,
      lean_mass_lb double precision,
      muscle_mass_lb double precision,
      bone_mass_lb double precision,
      body_water_percent double precision,
      visceral_fat double precision,
      waist_in double precision,
      chest_in double precision,
      hip_in double precision,
      notes text,
      -- "manual", or the HealthKit source it was replicated from, so a reading is never
      -- silently written back to the place it came from.
      source text,
      -- The HealthKit sample UUID when this came from Health, so re-syncing the same
      -- reading updates it instead of duplicating it.
      hk_uuid text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `
  await db`CREATE INDEX IF NOT EXISTS body_measurements_user ON body_measurements (user_id, recorded_at DESC)`
  await db`CREATE UNIQUE INDEX IF NOT EXISTS body_measurements_hk ON body_measurements (user_id, hk_uuid) WHERE hk_uuid IS NOT NULL`
}

function number(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function text(value, limit = 200) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, limit) : null
}

const FIELDS = ['weightLb', 'bodyFatPercent', 'leanMassLb', 'muscleMassLb', 'boneMassLb',
                'bodyWaterPercent', 'visceralFat', 'waistIn', 'chestIn', 'hipIn']

function normalizeRow(row) {
  return {
    id: String(row.id),
    recordedAt: new Date(row.recorded_at).toISOString(),
    weightLb: number(row.weight_lb),
    bodyFatPercent: number(row.body_fat_percent),
    leanMassLb: number(row.lean_mass_lb),
    muscleMassLb: number(row.muscle_mass_lb),
    boneMassLb: number(row.bone_mass_lb),
    bodyWaterPercent: number(row.body_water_percent),
    visceralFat: number(row.visceral_fat),
    waistIn: number(row.waist_in),
    chestIn: number(row.chest_in),
    hipIn: number(row.hip_in),
    notes: row.notes || null,
    source: row.source || null,
  }
}

export async function listBodyMeasurements(userId, { days = 365 } = {}) {
  await ensureBodySchema()
  const window = Math.min(3650, Math.max(1, Number(days) || 365))
  const db = sql()
  const rows = await db`
    SELECT * FROM body_measurements
    WHERE user_id = ${userId} AND recorded_at > now() - (${window} * interval '1 day')
    ORDER BY recorded_at DESC
    LIMIT ${MEASUREMENT_LIMIT}
  `
  return rows.map(normalizeRow)
}

export async function createBodyMeasurement(userId, body) {
  await ensureBodySchema()
  const values = Object.fromEntries(FIELDS.map((field) => [field, number(body?.[field])]))
  if (FIELDS.every((field) => values[field] == null)) {
    throw new Error('Enter at least one measurement.')
  }
  const recordedAt = body?.recordedAt ? new Date(body.recordedAt) : new Date()
  const at = Number.isNaN(recordedAt.getTime()) ? new Date() : recordedAt
  const db = sql()
  const [row] = await db`
    INSERT INTO body_measurements (
      user_id, recorded_at, weight_lb, body_fat_percent, lean_mass_lb, muscle_mass_lb,
      bone_mass_lb, body_water_percent, visceral_fat, waist_in, chest_in, hip_in, notes, source, hk_uuid
    ) VALUES (
      ${userId}, ${at.toISOString()}, ${values.weightLb}, ${values.bodyFatPercent}, ${values.leanMassLb},
      ${values.muscleMassLb}, ${values.boneMassLb}, ${values.bodyWaterPercent}, ${values.visceralFat},
      ${values.waistIn}, ${values.chestIn}, ${values.hipIn}, ${text(body?.notes, 1000)},
      ${text(body?.source) || 'manual'}, ${text(body?.hkUuid, 80)}
    )
    ON CONFLICT (user_id, hk_uuid) WHERE hk_uuid IS NOT NULL DO UPDATE SET
      recorded_at = EXCLUDED.recorded_at,
      weight_lb = EXCLUDED.weight_lb,
      body_fat_percent = EXCLUDED.body_fat_percent,
      lean_mass_lb = EXCLUDED.lean_mass_lb
    RETURNING *
  `
  return normalizeRow(row)
}

export async function deleteBodyMeasurement(userId, id) {
  await ensureBodySchema()
  const db = sql()
  const rows = await db`DELETE FROM body_measurements WHERE user_id = ${userId} AND id = ${id} RETURNING id`
  return rows.length > 0
}
