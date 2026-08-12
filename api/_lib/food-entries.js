import { sql } from './db.js'
import { getRecipe } from './recipes.js'
import { normalizeNutrients, nutrientColumns, nutrientsFromRow } from './nutrients.js'

// Shared food-diary writes. The dashboard API (api/mlog.js) and the MCP server
// (api/mcp.js) edit the same diary, so the SQL lives here once instead of being
// re-typed per surface. Every query is scoped by user_id — the diary is private, unlike
// the recipe bank it reads from.

const ENTRY_TEXT_LIMITS = { meal: 100, description: 1000, portion: 300, confidence: 30, notes: 1500 }
// The four nutrients that are mirrored into their own columns as well as the jsonb
// blob, so they can be summed without unpacking every row.
const COLUMN_NUTRIENTS = [['sugars_g', 'sugarsG'], ['added_sugars_g', 'addedSugarsG'], ['sodium_mg', 'sodiumMg'], ['caffeine_mg', 'caffeineMg']]

export function normalizeFoodRow(row) {
  return row ? { ...row, nutrients: nutrientsFromRow(row) } : null
}

export async function getFoodEntry(userId, entryId) {
  const db = sql()
  const rows = await db`
    SELECT id, occurred_at, meal, description, portion, calories_kcal, protein_g,
      carbs_g, fat_g, fiber_g, sugars_g, added_sugars_g, sodium_mg, caffeine_mg, nutrients, confidence, notes, source
    FROM food_entries WHERE user_id = ${userId} AND id::text = ${String(entryId)} LIMIT 1
  `
  return normalizeFoodRow(rows[0])
}

// Patch semantics: fields absent from `patch` keep their current value, and a field
// explicitly set to null is cleared. Returns null when the entry does not exist or
// belongs to someone else — the caller decides whether that is a 404 or a no-op.
export async function updateFoodEntry(userId, entryId, patch = {}) {
  const db = sql()
  const existing = await db`
    SELECT id, occurred_at, meal, description, portion, calories_kcal, protein_g,
      carbs_g, fat_g, fiber_g, sugars_g, added_sugars_g, sodium_mg, caffeine_mg, nutrients, confidence, notes, source
    FROM food_entries WHERE user_id = ${userId} AND id::text = ${String(entryId)} LIMIT 1
  `
  if (!existing.length) return null
  const current = existing[0]
  const has = (key) => Object.prototype.hasOwnProperty.call(patch, key)

  const description = has('description') ? cleanText(patch.description, ENTRY_TEXT_LIMITS.description, 'description') : current.description
  if (!description) throw new Error('description cannot be emptied — a food entry needs something to identify it.')

  // Micronutrients merge onto what is already stored, so a client can top up the
  // profile it knows without having to resend the rest. replace_nutrients swaps the
  // whole profile instead, and an explicit null clears one of the column-backed four.
  const incoming = normalizeNutrients({
    ...(patch.nutrients && typeof patch.nutrients === 'object' ? patch.nutrients : {}),
    ...Object.fromEntries(COLUMN_NUTRIENTS.filter(([arg]) => has(arg)).map(([arg]) => [arg, patch[arg]])),
  })
  const nutrients = { ...(patch.replace_nutrients === true ? {} : nutrientsFromRow(current)), ...incoming }
  for (const [arg, key] of COLUMN_NUTRIENTS) if (has(arg) && patch[arg] === null) delete nutrients[key]
  const columns = nutrientColumns(nutrients)

  const macro = (arg, column) => {
    if (!has(arg)) return current[column] ?? null
    if (patch[arg] === null) return null
    const parsed = Number(patch[arg])
    if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${arg} must be a nonnegative number.`)
    return parsed
  }
  const optional = (arg, column) => (has(arg) ? cleanText(patch[arg], ENTRY_TEXT_LIMITS[arg] ?? 300, arg) : current[column] ?? null)

  let occurredAt = current.occurred_at
  if (has('occurred_at')) {
    const parsed = new Date(String(patch.occurred_at))
    if (Number.isNaN(parsed.getTime())) throw new Error('occurred_at must be a valid ISO 8601 timestamp.')
    occurredAt = parsed.toISOString()
  }

  const rows = await db`
    UPDATE food_entries SET
      occurred_at = ${occurredAt},
      meal = ${optional('meal', 'meal')},
      description = ${description},
      portion = ${optional('portion', 'portion')},
      calories_kcal = ${macro('calories_kcal', 'calories_kcal')},
      protein_g = ${macro('protein_g', 'protein_g')},
      carbs_g = ${macro('carbs_g', 'carbs_g')},
      fat_g = ${macro('fat_g', 'fat_g')},
      fiber_g = ${macro('fiber_g', 'fiber_g')},
      sugars_g = ${columns.sugarsG},
      added_sugars_g = ${columns.addedSugarsG},
      sodium_mg = ${columns.sodiumMg},
      caffeine_mg = ${columns.caffeineMg},
      nutrients = ${JSON.stringify(nutrients)}::jsonb,
      confidence = ${optional('confidence', 'confidence')},
      notes = ${optional('notes', 'notes')},
      updated_at = now()
    WHERE user_id = ${userId} AND id::text = ${String(entryId)}
    RETURNING id, occurred_at, meal, description, portion, calories_kcal, protein_g,
      carbs_g, fat_g, fiber_g, sugars_g, added_sugars_g, sodium_mg, caffeine_mg, nutrients, confidence, notes, source
  `
  return { previous: normalizeFoodRow(current), entry: normalizeFoodRow(rows[0]) }
}

export async function deleteFoodEntry(userId, entryId) {
  const db = sql()
  const rows = await db`
    DELETE FROM food_entries WHERE user_id = ${userId} AND id::text = ${String(entryId)}
    RETURNING id, occurred_at, meal, description, portion, calories_kcal, protein_g,
      carbs_g, fat_g, fiber_g, sugars_g, added_sugars_g, sodium_mg, caffeine_mg, nutrients, confidence, notes, source
  `
  return normalizeFoodRow(rows[0])
}

// Logs a recipe from the shared bank into this user's private diary, scaling every
// figure by the number of servings. Failures are returned rather than thrown so each
// caller can map them onto its own status codes.
export async function logRecipeAsFood(userId, input = {}) {
  const recipeId = String(input.recipeId ?? input.recipe_id ?? '').trim()
  const name = String(input.name ?? '').trim()
  if (!recipeId && !name) return { ok: false, reason: 'missing_recipe' }

  const recipe = await getRecipe({ recipeId, name })
  if (!recipe) return { ok: false, reason: 'not_found' }
  // Logging a recipe with no nutrition would silently count as zero calories.
  if (recipe.nutrition?.calories == null) return { ok: false, reason: 'needs_nutrition', recipe: { id: recipe.id, name: recipe.name } }

  const servings = servingCount(input.servings)
  const scale = (value) => (value == null ? null : Math.round(value * servings * 10) / 10)
  const scaled = {}
  for (const [key, value] of Object.entries(normalizeNutrients(recipe.nutrition?.nutrients))) {
    scaled[key] = Math.round(value * servings * 1000) / 1000
  }
  const columns = nutrientColumns(scaled)

  const portion = servings === 1 ? (recipe.serving || '1 serving') : `${servings} × ${recipe.serving || 'serving'}`
  const notes = [`Logged from the Fuel recipe bank: ${recipe.name}.`]
  if (recipe.nutritionEstimated) notes.push('Nutrition for this recipe was estimated by Fuel AI.')

  let occurredAt = new Date()
  if (input.occurredAt || input.occurred_at) {
    const parsed = new Date(String(input.occurredAt ?? input.occurred_at))
    if (Number.isNaN(parsed.getTime())) throw new Error('occurred_at must be a valid ISO 8601 timestamp.')
    occurredAt = parsed
  }

  const db = sql()
  const rows = await db`
    INSERT INTO food_entries (
      user_id, occurred_at, meal, description, portion,
      calories_kcal, protein_g, carbs_g, fat_g, fiber_g,
      sugars_g, added_sugars_g, sodium_mg, caffeine_mg, nutrients,
      confidence, notes, source, updated_at
    ) VALUES (
      ${userId}, ${occurredAt.toISOString()}, ${cleanText(input.meal, ENTRY_TEXT_LIMITS.meal, 'meal') || ''}, ${recipe.name}, ${portion},
      ${scale(recipe.nutrition.calories)}, ${scale(recipe.nutrition.protein)},
      ${scale(recipe.nutrition.carbs)}, ${scale(recipe.nutrition.fat)}, ${scale(recipe.nutrition.fiber)},
      ${columns.sugarsG}, ${columns.addedSugarsG}, ${columns.sodiumMg}, ${columns.caffeineMg},
      ${JSON.stringify(scaled)}::jsonb,
      ${recipe.nutritionEstimated ? 'estimated' : 'recipe'}, ${notes.join(' ')},
      ${`Fuel recipe:${recipe.id}`}, now()
    )
    RETURNING id, occurred_at, meal, description, portion, calories_kcal, protein_g,
      carbs_g, fat_g, fiber_g, sugars_g, added_sugars_g, sodium_mg, caffeine_mg, nutrients, confidence, notes, source
  `
  return { ok: true, entry: normalizeFoodRow(rows[0]), recipe: { id: recipe.id, name: recipe.name }, servings }
}

// Quarter-serving granularity, capped so a typo cannot log fifty dinners.
export function servingCount(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 1
  return Math.min(20, Math.round(parsed * 4) / 4)
}

function cleanText(value, maximumLength, label) {
  if (value == null) return null
  const normalized = String(value).trim()
  if (!normalized) return null
  if (normalized.length > maximumLength) throw new Error(`${label} exceeds ${maximumLength} characters.`)
  return normalized
}
