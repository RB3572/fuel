import { sql } from './db.js'
import { normalizeNutrients, nutrientColumns, nutrientsFromRow } from './nutrients.js'

// The recipe bank is a SHARED, GLOBAL resource: a recipe added by anyone is visible
// to everyone. Unlike food_entries or health_daily, none of the reads below filter
// by user_id. The recipes.user_id column is retained only as provenance (who first
// contributed the row) and must never be used to scope a read — doing so would
// silently re-partition the bank per account.

let schemaReady = null

export function ensureRecipeSchema() {
  if (!schemaReady) schemaReady = migrate().catch((error) => { schemaReady = null; throw error })
  return schemaReady
}

async function migrate() {
  const db = sql()
  // A globally-owned recipe has no owner, so user_id must be droppable. The table
  // predates this repo, so tolerate a database role that cannot ALTER it: reads and
  // writes below work either way, and a NOT NULL user_id only means contributions
  // keep recording their author.
  try {
    await db`ALTER TABLE recipes ALTER COLUMN user_id DROP NOT NULL`
  } catch (error) {
    console.warn('recipes.user_id could not be made nullable; contributions will keep recording an author.', error?.message || error)
  }
  // Marks rows whose nutrition was inferred by Fuel AI rather than contributed, so
  // the recipe card and the logged food entry can both say so honestly.
  try {
    await db`ALTER TABLE recipes ADD COLUMN IF NOT EXISTS nutrition_estimated boolean NOT NULL DEFAULT false`
  } catch (error) {
    console.warn('recipes.nutrition_estimated is unavailable; estimates will not be labelled.', error?.message || error)
  }
  // Best effort: with the bank shared, one canonical row per name is the intent.
  // This fails harmlessly if two accounts already saved the same recipe name, in
  // which case saveRecipe's read-then-write path is the only dedupe.
  try {
    await db`CREATE UNIQUE INDEX IF NOT EXISTS recipes_global_name_key ON recipes (lower(name))`
  } catch {
    // Pre-existing duplicate names; saveRecipe still updates the first match.
  }
}

export async function listRecipes({ query = '', limit = 100 } = {}) {
  await ensureRecipeSchema()
  const db = sql()
  const pattern = `%${String(query).replace(/[%_\\]/g, '\\$&')}%`
  const rows = await db`
    SELECT id, name, serving, ingredients, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, nutrients, notes, source, user_id, nutrition_estimated, updated_at
    FROM recipes
    WHERE (${query} = '' OR name ILIKE ${pattern} ESCAPE '\\' OR ingredients ILIKE ${pattern} ESCAPE '\\')
    ORDER BY name ASC
    LIMIT ${limit}
  `
  return rows.map(normalizeRecipe)
}

export async function getRecipe({ recipeId = '', name = '' } = {}) {
  await ensureRecipeSchema()
  const db = sql()
  const rows = await db`
    SELECT id, name, serving, ingredients, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, nutrients, notes, source, user_id, nutrition_estimated, updated_at
    FROM recipes
    WHERE (${recipeId} <> '' AND id::text = ${recipeId})
       OR (${name} <> '' AND lower(name) = lower(${name}))
    ORDER BY name ASC
    LIMIT 1
  `
  return rows.length ? normalizeRecipe(rows[0]) : null
}

// Adds a recipe to the shared bank, or updates the existing recipe of the same name.
// contributorId is recorded for provenance only and never restricts who can read or
// overwrite the row.
export async function saveRecipe(input, contributorId = null) {
  await ensureRecipeSchema()
  const name = trimmed(input?.name, 300)
  if (!name) throw new Error('name is required.')

  const fields = {
    serving: trimmed(input?.serving, 200) || '',
    ingredients: joinList(input?.ingredients),
    notes: joinInstructions(input?.instructions),
    source: trimmed(input?.source, 500) || '',
    calories: nullableNumber(input?.calories),
    protein: nullableNumber(input?.protein),
    carbs: nullableNumber(input?.carbs),
    fat: nullableNumber(input?.fat),
    fiber: nullableNumber(input?.fiber),
  }
  const nutrients = normalizeNutrients({
    ...(input?.nutrients && typeof input.nutrients === 'object' ? input.nutrients : {}),
    sugars_g: input?.sugars_g,
    added_sugars_g: input?.added_sugars_g,
    sodium_mg: input?.sodium_mg,
    caffeine_mg: input?.caffeine_mg,
  })

  const existing = await getRecipe({ name })
  if (existing) return { recipe: await update(existing.id, fields, nutrients), created: false, updated: true }

  try {
    return { recipe: await insert(name, fields, nutrients, contributorId), created: true, updated: false }
  } catch (error) {
    // Lost a race against a concurrent contributor adding the same name, and the
    // unique index rejected this insert. Their row exists now, so update it.
    if (error?.code !== '23505') throw error
    const winner = await getRecipe({ name })
    if (!winner) throw error
    return { recipe: await update(winner.id, fields, nutrients), created: false, updated: true }
  }
}

async function insert(name, f, nutrients, contributorId) {
  const db = sql()
  const cols = nutrientColumns(nutrients)
  const rows = await db`
    INSERT INTO recipes (name, serving, ingredients, notes, source, user_id,
      calories_kcal, protein_g, carbs_g, fat_g, fiber_g,
      sugars_g, added_sugars_g, sodium_mg, caffeine_mg, nutrients, updated_at)
    VALUES (${name}, ${f.serving}, ${f.ingredients}, ${f.notes}, ${f.source}, ${contributorId},
      ${f.calories}, ${f.protein}, ${f.carbs}, ${f.fat}, ${f.fiber},
      ${cols.sugarsG}, ${cols.addedSugarsG}, ${cols.sodiumMg}, ${cols.caffeineMg},
      ${JSON.stringify(nutrients)}::jsonb, now())
    RETURNING id, name, serving, ingredients, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, nutrients, notes, source, user_id, nutrition_estimated, updated_at
  `
  return normalizeRecipe(rows[0])
}

async function update(id, f, nutrients) {
  const db = sql()
  const cols = nutrientColumns(nutrients)
  const rows = await db`
    UPDATE recipes SET
      serving = ${f.serving}, ingredients = ${f.ingredients}, notes = ${f.notes}, source = ${f.source},
      calories_kcal = ${f.calories}, protein_g = ${f.protein}, carbs_g = ${f.carbs},
      fat_g = ${f.fat}, fiber_g = ${f.fiber},
      sugars_g = ${cols.sugarsG}, added_sugars_g = ${cols.addedSugarsG},
      sodium_mg = ${cols.sodiumMg}, caffeine_mg = ${cols.caffeineMg},
      nutrients = ${JSON.stringify(nutrients)}::jsonb, updated_at = now()
    WHERE id = ${id}
    RETURNING id, name, serving, ingredients, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, nutrients, notes, source, user_id, nutrition_estimated, updated_at
  `
  return normalizeRecipe(rows[0])
}

export function normalizeRecipe(row) {
  const name = row.name || 'Untitled recipe'
  return {
    id: row.id,
    name,
    category: categoryFor(name),
    serving: row.serving || '',
    ingredients: splitList(row.ingredients),
    instructions: splitInstructions(row.notes),
    nutrition: {
      calories: nullableNumber(row.calories_kcal),
      protein: nullableNumber(row.protein_g),
      carbs: nullableNumber(row.carbs_g),
      fat: nullableNumber(row.fat_g),
      fiber: nullableNumber(row.fiber_g),
      nutrients: nutrientsFromRow(row),
    },
    source: row.source || '',
    nutritionEstimated: row.nutrition_estimated === true,
    hasNutrition: nullableNumber(row.calories_kcal) != null,
    updatedAt: row.updated_at || null,
  }
}

function categoryFor(name) {
  const lower = name.toLowerCase()
  if (lower.includes('creami') || lower.includes('ninja')) return 'Ninja Creami'
  if (lower.includes('oat')) return 'Breakfast and oats'
  if (lower.includes('smoothie') || lower.includes('shake')) return 'Drinks and smoothies'
  if (lower.includes('dessert') || lower.includes('cookie') || lower.includes('ice cream')) return 'Desserts'
  return 'Other recipes'
}

function splitList(value) {
  return value ? String(value).split(/\s*;\s*|\n+/).map((item) => item.trim()).filter(Boolean) : []
}
function splitInstructions(value) {
  if (!value || /^saved recipe\.?$/i.test(String(value).trim())) return []
  return String(value).split(/\n+|(?<=\.)\s+(?=[A-Z0-9])/).map((item) => item.trim()).filter(Boolean)
}
// splitList splits on ';' and newlines, so join with newlines to round-trip cleanly
// even when an ingredient legitimately contains a semicolon.
function joinList(value) {
  const items = Array.isArray(value) ? value : splitList(value)
  return items.map((item) => String(item).trim()).filter(Boolean).join('\n')
}
function joinInstructions(value) {
  const items = Array.isArray(value) ? value : splitInstructions(value)
  return items.map((item) => String(item).trim()).filter(Boolean).join('\n')
}
function trimmed(value, maximumLength) {
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, maximumLength)
}
function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

// Recipes that cannot be one-click logged yet: no calorie figure, but enough
// ingredient detail for Fuel AI to estimate one.
export async function recipesNeedingNutrition(limit = 200) {
  await ensureRecipeSchema()
  const db = sql()
  const rows = await db`
    SELECT id, name, serving, ingredients, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, nutrients, notes, source, user_id, nutrition_estimated, updated_at
    FROM recipes
    WHERE calories_kcal IS NULL
      AND ingredients IS NOT NULL AND btrim(ingredients) <> ''
    ORDER BY name ASC
    LIMIT ${limit}
  `
  return rows.map(normalizeRecipe)
}

// Writes an AI-derived breakdown onto a recipe. Kept separate from saveRecipe so a
// backfill can never clobber a contributor's own ingredients or instructions.
export async function saveEstimatedNutrition(recipeId, estimate) {
  await ensureRecipeSchema()
  const db = sql()
  const nutrients = normalizeNutrients(estimate?.nutrients)
  const cols = nutrientColumns(nutrients)
  const rows = await db`
    UPDATE recipes SET
      calories_kcal = ${numberOrNull(estimate?.calories)},
      protein_g = ${numberOrNull(estimate?.protein)},
      carbs_g = ${numberOrNull(estimate?.carbs)},
      fat_g = ${numberOrNull(estimate?.fat)},
      fiber_g = ${numberOrNull(estimate?.fiber)},
      sugars_g = ${cols.sugarsG}, added_sugars_g = ${cols.addedSugarsG},
      sodium_mg = ${cols.sodiumMg}, caffeine_mg = ${cols.caffeineMg},
      nutrients = ${JSON.stringify(nutrients)}::jsonb,
      nutrition_estimated = true,
      updated_at = now()
    WHERE id = ${recipeId} AND calories_kcal IS NULL
    RETURNING id, name, serving, ingredients, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, nutrients, notes, source, user_id, nutrition_estimated, updated_at
  `
  return rows.length ? normalizeRecipe(rows[0]) : null
}

function numberOrNull(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}
