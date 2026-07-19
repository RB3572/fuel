import { sql } from './db.js'

// Section keys the dashboard knows how to render, in their default order. The energy
// hero is always first and cannot be hidden or moved.
export const DASHBOARD_SECTIONS = ['nutrition', 'detailedNutrition', 'foodConsumed', 'fitness', 'workouts', 'steps', 'vitals', 'recovery']
export const ENERGY_BOXES = ['totalBurned', 'consumed', 'active', 'resting', 'deficit']

export async function ensureDashboardLayoutTable() {
  const db = sql()
  await db`
    CREATE TABLE IF NOT EXISTS user_dashboard_layout (
      user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
      layout jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `
}

export async function getDashboardLayout(userId) {
  await ensureDashboardLayoutTable()
  const db = sql()
  const rows = await db`SELECT layout FROM user_dashboard_layout WHERE user_id = ${userId} LIMIT 1`
  return normalizeLayout(rows[0]?.layout)
}

export async function saveDashboardLayout(userId, value) {
  const layout = normalizeLayout(value)
  await ensureDashboardLayoutTable()
  const db = sql()
  await db`
    INSERT INTO user_dashboard_layout (user_id, layout, updated_at)
    VALUES (${userId}, ${JSON.stringify(layout)}::jsonb, now())
    ON CONFLICT (user_id) DO UPDATE SET layout = EXCLUDED.layout, updated_at = now()
  `
  return layout
}

// Always return a complete, valid layout: known sections only, every section present
// exactly once (custom order first, missing ones appended), and a valid box list.
export function normalizeLayout(value) {
  const raw = value && typeof value === 'object' ? value : {}
  const order = []
  const seen = new Set()
  for (const key of Array.isArray(raw.order) ? raw.order : []) {
    if (DASHBOARD_SECTIONS.includes(key) && !seen.has(key)) { order.push(key); seen.add(key) }
  }
  for (const key of DASHBOARD_SECTIONS) if (!seen.has(key)) order.push(key)

  const hidden = [...new Set((Array.isArray(raw.hidden) ? raw.hidden : []).filter((key) => DASHBOARD_SECTIONS.includes(key)))]

  let energyBoxes
  if (raw.energyBoxes === undefined) {
    energyBoxes = [...ENERGY_BOXES]
  } else {
    energyBoxes = []
    const seenBox = new Set()
    for (const key of Array.isArray(raw.energyBoxes) ? raw.energyBoxes : []) {
      if (ENERGY_BOXES.includes(key) && !seenBox.has(key)) { energyBoxes.push(key); seenBox.add(key) }
    }
  }

  return { order, hidden, energyBoxes }
}
