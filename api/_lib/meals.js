import { sql } from './db.js'

// A user's own saved meals — the things they actually eat, as opposed to the shared
// recipe bank (recipes.js), which is a global library everyone reads. A meal is one or
// more items with their nutrition, saved under a name so it can be logged again in one
// tap: "my usual breakfast", "Chipotle bowl", "post-swim shake".
//
// Meals are stored with their items rather than as a single summed row, so re-logging
// one reproduces the diary entries it was made from instead of collapsing a breakfast
// into an anonymous 620 kcal line.

const NAME_LIMIT = 120
const ITEM_LIMIT = 30

let schemaReady = null
export function ensureMealsSchema() {
  if (!schemaReady) schemaReady = migrate().catch((error) => { schemaReady = null; throw error })
  return schemaReady
}

async function migrate() {
  const db = sql()
  await db`
    CREATE TABLE IF NOT EXISTS user_meals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      name text NOT NULL,
      meal text,
      -- The items, each with its own description, portion and nutrition. Kept as jsonb
      -- because a meal's shape is only ever read whole.
      items jsonb NOT NULL DEFAULT '[]'::jsonb,
      log_count integer NOT NULL DEFAULT 0,
      last_logged_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `
  await db`CREATE INDEX IF NOT EXISTS user_meals_user ON user_meals (user_id, updated_at DESC)`
}

function text(value, limit = NAME_LIMIT) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, limit) : null
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/// One item of a meal, with only the fields the diary stores. Anything else a caller
/// sends is dropped rather than persisted — a meal is not a place to stash arbitrary
/// data under a user's row.
function normalizeItem(raw) {
  const description = text(raw?.description ?? raw?.food ?? raw?.name, 1000)
  if (!description) return null
  return {
    description,
    portion: text(raw?.portion, 300),
    calories: number(raw?.calories ?? raw?.calories_kcal),
    protein: number(raw?.protein ?? raw?.protein_g),
    carbs: number(raw?.carbs ?? raw?.carbs_g),
    fat: number(raw?.fat ?? raw?.fat_g),
    fiber: number(raw?.fiber ?? raw?.fiber_g),
  }
}

function sumItems(items) {
  const total = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }
  let any = false
  for (const item of items) {
    for (const key of Object.keys(total)) {
      if (item[key] != null) { total[key] += item[key]; any = true }
    }
  }
  return any ? total : null
}

function shape(row) {
  const items = Array.isArray(row.items) ? row.items : []
  return {
    id: String(row.id),
    name: row.name,
    meal: row.meal || null,
    items,
    nutrition: sumItems(items),
    logCount: Number(row.log_count) || 0,
    lastLoggedAt: row.last_logged_at ? new Date(row.last_logged_at).toISOString() : null,
  }
}

export async function listMeals(userId) {
  await ensureMealsSchema()
  const db = sql()
  // Most-logged first, then most recently touched: the meal you eat every morning
  // should not sink below one you saved once and never used.
  const rows = await db`
    SELECT id, name, meal, items, log_count, last_logged_at
    FROM user_meals WHERE user_id = ${userId}
    ORDER BY log_count DESC, updated_at DESC
    LIMIT 200
  `
  return rows.map(shape)
}

export async function createMeal(userId, input = {}) {
  await ensureMealsSchema()
  const name = text(input.name)
  if (!name) throw new Error('A meal name is required.')
  const items = (Array.isArray(input.items) ? input.items : []).map(normalizeItem).filter(Boolean).slice(0, ITEM_LIMIT)
  if (!items.length) throw new Error('A meal needs at least one item.')

  const db = sql()
  const rows = await db`
    INSERT INTO user_meals (user_id, name, meal, items)
    VALUES (${userId}, ${name}, ${text(input.meal, 100)}, ${JSON.stringify(items)}::jsonb)
    RETURNING id, name, meal, items, log_count, last_logged_at
  `
  return shape(rows[0])
}

/// Turns diary entries the user already logged into a reusable meal. The nutrition is
/// read from the entries server-side rather than accepted from the client, so a saved
/// meal always matches what was actually eaten.
export async function createMealFromEntries(userId, input = {}) {
  await ensureMealsSchema()
  const ids = (Array.isArray(input.entryIds) ? input.entryIds : []).map(String).filter(Boolean).slice(0, ITEM_LIMIT)
  if (!ids.length) throw new Error('Select at least one logged entry.')

  const db = sql()
  const rows = await db`
    SELECT description, portion, meal, calories_kcal, protein_g, carbs_g, fat_g, fiber_g
    FROM food_entries
    WHERE user_id = ${userId} AND id::text = ANY(${ids})
    ORDER BY occurred_at ASC
  `
  if (!rows.length) throw new Error('Those entries were not found.')

  const items = rows.map((row) => normalizeItem({
    description: row.description,
    portion: row.portion,
    calories: row.calories_kcal,
    protein: row.protein_g,
    carbs: row.carbs_g,
    fat: row.fat_g,
    fiber: row.fiber_g,
  })).filter(Boolean)

  // Default to the entries' own name when there is one item, so saving a single entry
  // does not demand the user retype what it already says.
  const name = text(input.name) || (items.length === 1 ? items[0].description : null)
  if (!name) throw new Error('A meal name is required.')

  const created = await db`
    INSERT INTO user_meals (user_id, name, meal, items)
    VALUES (${userId}, ${name}, ${text(input.meal, 100) || rows[0].meal || null}, ${JSON.stringify(items)}::jsonb)
    RETURNING id, name, meal, items, log_count, last_logged_at
  `
  return shape(created[0])
}

export async function deleteMeal(userId, mealId) {
  await ensureMealsSchema()
  const db = sql()
  const rows = await db`
    DELETE FROM user_meals WHERE user_id = ${userId} AND id::text = ${String(mealId)} RETURNING id
  `
  return rows.length > 0
}

export async function getMeal(userId, mealId) {
  await ensureMealsSchema()
  const db = sql()
  const rows = await db`
    SELECT id, name, meal, items, log_count, last_logged_at
    FROM user_meals WHERE user_id = ${userId} AND id::text = ${String(mealId)} LIMIT 1
  `
  return rows.length ? shape(rows[0]) : null
}

export async function markMealLogged(userId, mealId) {
  const db = sql()
  await db`
    UPDATE user_meals SET log_count = log_count + 1, last_logged_at = now(), updated_at = now()
    WHERE user_id = ${userId} AND id::text = ${String(mealId)}
  `
}

/// What the user has logged before, deduplicated by name, most recent first. This is the
/// third shelf of the log library: things they have eaten but never bothered to save.
/// The nutrition comes from the most recent time they logged it, since that is the
/// version they most recently corrected.
export async function foodHistory(userId, { limit = 100, days = 180 } = {}) {
  const db = sql()
  const window = Math.min(730, Math.max(1, Number(days) || 180))
  const cap = Math.min(300, Math.max(1, Number(limit) || 100))
  const rows = await db`
    SELECT DISTINCT ON (lower(description))
      description, portion, meal, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, occurred_at
    FROM food_entries
    WHERE user_id = ${userId}
      AND description IS NOT NULL AND description <> ''
      AND occurred_at > now() - (${window} * interval '1 day')
    ORDER BY lower(description), occurred_at DESC
  `
  // Postgres forces DISTINCT ON to order by its key first, so the recency sort and the
  // limit both have to happen here rather than in the query.
  return rows
    .map((row) => ({
      description: row.description,
      portion: row.portion || null,
      meal: row.meal || null,
      calories: number(row.calories_kcal),
      protein: number(row.protein_g),
      carbs: number(row.carbs_g),
      fat: number(row.fat_g),
      fiber: number(row.fiber_g),
      lastLoggedAt: new Date(row.occurred_at).toISOString(),
    }))
    .sort((a, b) => (a.lastLoggedAt < b.lastLoggedAt ? 1 : -1))
    .slice(0, cap)
}
