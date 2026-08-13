import { sql } from './db.js'
// A `date` column arrives as a Date object, and String()ing one yields "Thu Jan 02" —
// so the ISO key is built the same way the dashboard builds its day keys.
import { databaseDateKey } from './neon-dashboard.js'

// Blood panels: what a lab reported, kept as reported. A panel is one draw — a date, a
// lab, and the markers it measured — and the markers are stored with the panel rather
// than in their own table, because a result only ever means anything alongside the
// reference range printed next to it on that report. Ranges differ between labs and get
// revised over time; storing the range with the result is what keeps a value from being
// re-judged years later against a range it was never measured under.
//
// Nothing here interprets anything. The reference range decides high/low, and the
// explanatory text the app shows lives client-side in BloodMarkers.swift with its
// sources. This file only stores and returns what the lab said.

const TEXT_LIMIT = 200
const MARKER_LIMIT = 200

let schemaReady = null
export function ensureBloodSchema() {
  if (!schemaReady) schemaReady = migrate().catch((error) => { schemaReady = null; throw error })
  return schemaReady
}

async function migrate() {
  const db = sql()
  await db`
    CREATE TABLE IF NOT EXISTS blood_panels (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      -- The draw date. Null when the report did not carry one, which is why the list is
      -- ordered by it with a fallback rather than assuming it is always present.
      collected_on date,
      lab text,
      notes text,
      -- Each marker with the value, unit and reference range as printed.
      markers jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `
  await db`CREATE INDEX IF NOT EXISTS blood_panels_user ON blood_panels (user_id, collected_on DESC NULLS LAST, created_at DESC)`
}

function text(value, limit = TEXT_LIMIT) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, limit) : null
}

function number(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/// One marker, reduced to the fields a result is made of. A lab line that reported no
/// number at all — "-- (Cancelled)" — is still kept: that a test was ordered and did not
/// produce a result is itself part of the record, and silently dropping it would make
/// the panel look like the test was never requested.
function normalizeMarker(raw) {
  const name = text(raw?.name, 120)
  if (!name) return null
  const low = number(raw?.referenceLow)
  const high = number(raw?.referenceHigh)
  const value = number(raw?.value)
  // Derived here rather than trusted from the input: a report's own flag column is
  // often blank even when the value sits outside the printed range, and the two must
  // never disagree in the same row.
  let flag = null
  if (value != null) {
    if (low != null && value < low) flag = 'low'
    else if (high != null && value > high) flag = 'high'
  }
  return {
    name,
    value,
    valueText: text(raw?.valueText, 120),
    unit: text(raw?.unit, 40),
    referenceLow: low,
    referenceHigh: high,
    referenceText: text(raw?.referenceText, 120),
    flag,
    category: text(raw?.category, 60),
  }
}

export async function listBloodPanels(userId) {
  await ensureBloodSchema()
  const db = sql()
  const rows = await db`
    SELECT id, collected_on, lab, notes, markers, created_at
    FROM blood_panels
    WHERE user_id = ${userId}
    ORDER BY collected_on DESC NULLS LAST, created_at DESC
  `
  return rows.map((row) => ({
    id: String(row.id),
    collectedOn: row.collected_on ? databaseDateKey(row.collected_on) || null : null,
    lab: row.lab || null,
    notes: row.notes || null,
    markers: Array.isArray(row.markers) ? row.markers : [],
    createdAt: new Date(row.created_at).toISOString(),
  }))
}

export async function createBloodPanel(userId, body) {
  await ensureBloodSchema()
  const markers = Array.isArray(body?.markers)
    ? body.markers.map(normalizeMarker).filter(Boolean).slice(0, MARKER_LIMIT)
    : []
  if (!markers.length) throw new Error('A panel needs at least one result.')
  const collectedOn = typeof body?.collectedOn === 'string' && ISO_DATE.test(body.collectedOn)
    ? body.collectedOn
    : null
  const db = sql()
  const [row] = await db`
    INSERT INTO blood_panels (user_id, collected_on, lab, notes, markers)
    VALUES (${userId}, ${collectedOn}::date, ${text(body?.lab, 120)}, ${text(body?.notes, 2000)},
            ${JSON.stringify(markers)}::jsonb)
    RETURNING id, collected_on, lab, notes, markers, created_at
  `
  return {
    id: String(row.id),
    collectedOn: row.collected_on ? databaseDateKey(row.collected_on) || null : null,
    lab: row.lab || null,
    notes: row.notes || null,
    markers,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

export async function deleteBloodPanel(userId, id) {
  await ensureBloodSchema()
  const db = sql()
  const rows = await db`DELETE FROM blood_panels WHERE user_id = ${userId} AND id = ${id} RETURNING id`
  return rows.length > 0
}
