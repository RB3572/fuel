import { ensureUserFromSession, sql, userForSyncToken } from './_lib/db.js'
import { authenticatedSession, appUrl } from './_lib/google.js'
import { methodNotAllowed, sendJson } from './_lib/http.js'
import { handleMealPlan } from './_lib/meal-plan.js'
import { handleMcpOAuthRoute } from './_lib/mcp-oauth-routes.js'
import { authorizationServerMetadata } from './_lib/mcp-auth.js'
import { getDynamicClientMetadata, registerDynamicClient } from './_lib/mcp-dcr.js'
import { getNeonDashboard } from './_lib/neon-dashboard.js'
import { getUserContext, saveUserContext } from './_lib/user-context.js'
import { getDashboardLayout, saveDashboardLayout } from './_lib/dashboard-layout.js'
import { getRecipe, recipesNeedingNutrition, saveEstimatedNutrition } from './_lib/recipes.js'
import { estimateRecipeNutrition, NutritionQuotaError } from './_lib/recipe-nutrition.js'
import { estimateFoodNutrition } from './_lib/food-nutrition.js'
import { ensureNutrientSchema, normalizeNutrients, nutrientColumns } from './_lib/nutrients.js'

const TIME_ZONE = 'America/Los_Angeles'

export default async function handler(req, res) {
  const integrationRoute = routeFromRequest(req)
  if (integrationRoute === 'authorization-server') {
    if (req.method !== 'GET') {
      methodNotAllowed(res, ['GET'])
      return
    }
    res.setHeader('Cache-Control', 'public, max-age=300')
    sendJson(res, 200, {
      ...authorizationServerMetadata(),
      registration_endpoint: `${appUrl()}/oauth/register`,
    })
    return
  }
  if (integrationRoute === 'register') {
    if (req.method !== 'POST') {
      methodNotAllowed(res, ['POST'])
      return
    }
    res.setHeader('Cache-Control', 'no-store')
    try {
      const client = await registerDynamicClient(unwrap(req.body))
      sendJson(res, 201, client)
    } catch (error) {
      sendJson(res, error.statusCode || 400, {
        error: error.oauthCode || 'invalid_client_metadata',
        error_description: error.message || 'Unable to register this OAuth client.',
      })
    }
    return
  }
  if (integrationRoute === 'client-metadata') {
    if (req.method !== 'GET') {
      methodNotAllowed(res, ['GET'])
      return
    }
    const requestUrl = new URL(req.url, appUrl())
    requestUrl.searchParams.delete('fuel_route')
    const clientId = `${appUrl()}/oauth/client-metadata?id=${encodeURIComponent(requestUrl.searchParams.get('id') || '')}`
    const metadata = await getDynamicClientMetadata(clientId)
    if (!metadata) {
      sendJson(res, 404, { error: 'OAuth client not found.' })
      return
    }
    res.setHeader('Cache-Control', 'public, max-age=300')
    sendJson(res, 200, metadata)
    return
  }
  if (integrationRoute === 'user-context') {
    await handleUserContext(req, res)
    return
  }
  if (integrationRoute === 'dashboard-layout') {
    await handleDashboardLayout(req, res)
    return
  }
  if (integrationRoute === 'log-recipe') {
    await handleLogRecipe(req, res)
    return
  }
  if (integrationRoute === 'recipe-nutrition') {
    await handleRecipeNutrition(req, res)
    return
  }
  if (integrationRoute === 'food-nutrition') {
    await handleFoodNutrition(req, res)
    return
  }
  if (integrationRoute === 'meal-plan') {
    await handleMealPlan(req, res)
    return
  }
  if (integrationRoute) {
    await handleMcpOAuthRoute(integrationRoute, req, res)
    return
  }

  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) {
    methodNotAllowed(res, ['GET', 'POST', 'PUT', 'DELETE'])
    return
  }

  try {
    const auth = await authenticatedUser(req)
    if (!auth) {
      sendJson(res, 401, { error: 'Sign in or provide a valid Fuel bearer token.' })
      return
    }

    if (req.method === 'GET') {
      const dashboard = await getNeonDashboard(auth.id)
      const [intraday, rolling24h] = await Promise.all([getIntradayEnergy(auth.id), getRolling24h(auth.id)])
      dashboard.intradayEnergy = intraday
      dashboard.rolling24h = rolling24h
      sendJson(res, 200, dashboard, auth.cookie ? [auth.cookie] : [])
      return
    }

    const body = unwrap(req.body)
    if (req.method === 'DELETE') {
      const entryId = text(body.entryId ?? body.entry_id ?? body.id)
      if (!entryId) {
        sendJson(res, 422, { error: 'A food entry ID is required.' })
        return
      }
      const db = sql()
      const rows = await db`
        DELETE FROM food_entries
        WHERE user_id = ${auth.id} AND id::text = ${entryId}
        RETURNING id, occurred_at, meal, description, portion, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, confidence, notes, source
      `
      if (!rows.length) {
        sendJson(res, 404, { error: 'Food entry not found.' }, auth.cookie ? [auth.cookie] : [])
        return
      }
      sendJson(res, 200, { ok: true, deleted: true, entry: rows[0] }, auth.cookie ? [auth.cookie] : [])
      return
    }
    if (req.method === 'PUT') {
      const entryId = text(body.entryId ?? body.entry_id ?? body.id)
      if (!entryId) {
        sendJson(res, 422, { error: 'A food entry ID is required.' })
        return
      }
      const editedDescription = text(body.description ?? body.food ?? body.name)
      if (!editedDescription) {
        sendJson(res, 422, { error: 'A food description is required.' })
        return
      }
      const db = sql()
      const rows = await db`
        UPDATE food_entries SET
          meal = ${text(body.meal)},
          description = ${editedDescription},
          portion = ${text(body.portion)},
          calories_kcal = ${number(body.calories ?? body.caloriesKcal ?? body.calories_kcal)},
          protein_g = ${number(body.protein ?? body.proteinG ?? body.protein_g)},
          carbs_g = ${number(body.carbs ?? body.carbsG ?? body.carbs_g)},
          fat_g = ${number(body.fat ?? body.fatG ?? body.fat_g)},
          fiber_g = ${number(body.fiber ?? body.fiberG ?? body.fiber_g)},
          updated_at = now()
        WHERE user_id = ${auth.id} AND id::text = ${entryId}
        RETURNING id, occurred_at, meal, description, portion, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, confidence, notes, source
      `
      if (!rows.length) {
        sendJson(res, 404, { error: 'Food entry not found.' }, auth.cookie ? [auth.cookie] : [])
        return
      }
      sendJson(res, 200, { ok: true, updated: true, entry: rows[0] }, auth.cookie ? [auth.cookie] : [])
      return
    }
    const description = text(body.description ?? body.food ?? body.name)
    if (!description) {
      sendJson(res, 422, { error: 'A food description is required.' })
      return
    }

    const occurredAt = validDate(body.occurredAt ?? body.occurred_at ?? body.date) || new Date()
    const db = sql()
    const rows = await db`
      INSERT INTO food_entries (
        user_id, occurred_at, meal, description, portion,
        calories_kcal, protein_g, carbs_g, fat_g, fiber_g,
        confidence, notes, source, updated_at
      ) VALUES (
        ${auth.id}, ${occurredAt.toISOString()}, ${text(body.meal)}, ${description}, ${text(body.portion)},
        ${number(body.calories ?? body.caloriesKcal ?? body.calories_kcal)},
        ${number(body.protein ?? body.proteinG ?? body.protein_g)},
        ${number(body.carbs ?? body.carbsG ?? body.carbs_g)},
        ${number(body.fat ?? body.fatG ?? body.fat_g)},
        ${number(body.fiber ?? body.fiberG ?? body.fiber_g)},
        ${text(body.confidence) || 'estimated'}, ${text(body.notes)}, ${text(body.source) || 'Fuel API'}, now()
      )
      RETURNING id, occurred_at, meal, description, portion,
        calories_kcal, protein_g, carbs_g, fat_g, fiber_g,
        confidence, notes, source
    `

    sendJson(res, 201, { ok: true, entry: rows[0] }, auth.cookie ? [auth.cookie] : [])
  } catch (error) {
    const operation = req.method === 'POST' ? 'Food logging' : req.method === 'PUT' ? 'Food update' : req.method === 'DELETE' ? 'Food deletion' : 'Dashboard loading'
    console.error(`${operation} failed`, error)
    const message = req.method === 'POST' ? 'Food could not be logged.' : req.method === 'PUT' ? 'Food entry could not be updated.' : req.method === 'DELETE' ? 'Food entry could not be deleted.' : 'Unable to load Fuel data.'
    sendJson(res, 500, { error: message })
  }
}

// One-click logging of a saved recipe. The nutrition is read from the recipe bank
// server-side rather than accepted from the client, so what lands in food_entries
// always matches the recipe and cannot be forged by a crafted request.
async function handleLogRecipe(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }
  res.setHeader('Cache-Control', 'no-store')
  try {
    const auth = await authenticatedUser(req)
    if (!auth) {
      sendJson(res, 401, { error: 'Sign in to log a recipe.' })
      return
    }
    await ensureNutrientSchema()
    const body = unwrap(req.body)
    const recipeId = text(body.recipeId ?? body.recipe_id) || ''
    const recipeName = text(body.name) || ''
    if (!recipeId && !recipeName) {
      sendJson(res, 422, { error: 'A recipe is required.' }, auth.cookie ? [auth.cookie] : [])
      return
    }
    const recipe = await getRecipe({ recipeId, name: recipeName })
    if (!recipe) {
      sendJson(res, 404, { error: 'That recipe is no longer in the recipe bank.' }, auth.cookie ? [auth.cookie] : [])
      return
    }
    if (recipe.nutrition?.calories == null) {
      sendJson(res, 409, {
        error: `${recipe.name} has no nutrition breakdown yet, so logging it would count as zero calories.`,
        needsNutrition: true,
        recipeId: recipe.id,
      }, auth.cookie ? [auth.cookie] : [])
      return
    }

    const servings = servingCount(body.servings)
    const scale = (value) => (value == null ? null : Math.round(value * servings * 10) / 10)
    const nutrients = normalizeNutrients(recipe.nutrition?.nutrients)
    const scaled = {}
    for (const [key, value] of Object.entries(nutrients)) scaled[key] = Math.round(value * servings * 1000) / 1000
    const cols = nutrientColumns(scaled)

    const portion = servings === 1
      ? (recipe.serving || '1 serving')
      : `${formatServings(servings)} \u00d7 ${recipe.serving || 'serving'}`
    const noteParts = [`Logged from the Fuel recipe bank: ${recipe.name}.`]
    if (recipe.nutritionEstimated) noteParts.push('Nutrition for this recipe was estimated by Fuel AI.')

    const db = sql()
    const rows = await db`
      INSERT INTO food_entries (
        user_id, occurred_at, meal, description, portion,
        calories_kcal, protein_g, carbs_g, fat_g, fiber_g,
        sugars_g, added_sugars_g, sodium_mg, caffeine_mg, nutrients,
        confidence, notes, source, updated_at
      ) VALUES (
        ${auth.id}, ${new Date().toISOString()}, ${text(body.meal) || ''}, ${recipe.name}, ${portion},
        ${scale(recipe.nutrition.calories)}, ${scale(recipe.nutrition.protein)},
        ${scale(recipe.nutrition.carbs)}, ${scale(recipe.nutrition.fat)}, ${scale(recipe.nutrition.fiber)},
        ${cols.sugarsG}, ${cols.addedSugarsG}, ${cols.sodiumMg}, ${cols.caffeineMg},
        ${JSON.stringify(scaled)}::jsonb,
        ${recipe.nutritionEstimated ? 'estimated' : 'recipe'}, ${noteParts.join(' ')},
        ${`Fuel recipe:${recipe.id}`}, now()
      )
      RETURNING id, occurred_at, meal, description, portion, calories_kcal, protein_g, carbs_g, fat_g, fiber_g
    `
    sendJson(res, 201, { ok: true, entry: rows[0], recipe: { id: recipe.id, name: recipe.name }, servings }, auth.cookie ? [auth.cookie] : [])
  } catch (error) {
    console.error('Recipe logging failed', error)
    sendJson(res, 500, { error: 'That recipe could not be logged.' })
  }
}

// Fills in missing nutrition so those recipes become one-click loggable. Bounded per
// request: Gemini is called once per recipe and serverless functions have a deadline.
async function handleRecipeNutrition(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    methodNotAllowed(res, ['GET', 'POST'])
    return
  }
  res.setHeader('Cache-Control', 'no-store')
  try {
    const auth = await authenticatedUser(req)
    if (!auth) {
      sendJson(res, 401, { error: 'Sign in to fill in recipe nutrition.' })
      return
    }
    const pending = await recipesNeedingNutrition(200)
    if (req.method === 'GET') {
      sendJson(res, 200, { pending: pending.length, recipes: pending.map((r) => ({ id: r.id, name: r.name })) }, auth.cookie ? [auth.cookie] : [])
      return
    }
    const body = unwrap(req.body)
    const requestedId = text(body.recipeId ?? body.recipe_id) || ''
    const batch = requestedId ? pending.filter((r) => String(r.id) === requestedId) : pending.slice(0, batchSize(body.limit))
    const updated = []
    const failed = []
    let quotaError = ''
    for (const recipe of batch) {
      try {
        const estimate = await estimateRecipeNutrition(recipe)
        const saved = await saveEstimatedNutrition(recipe.id, estimate)
        if (saved) updated.push({ id: saved.id, name: saved.name, nutrition: saved.nutrition, assumptions: estimate.assumptions })
      } catch (error) {
        if (error instanceof NutritionQuotaError) {
          // Every remaining call would fail the same way, so stop and say why
          // rather than reporting a pile of identical per-recipe failures.
          quotaError = error.message
          break
        }
        console.error(`Recipe nutrition estimate failed for ${recipe.name}`, error)
        failed.push({ id: recipe.id, name: recipe.name, error: error instanceof Error ? error.message : 'Estimate failed.' })
      }
    }
    if (quotaError && !updated.length) {
      sendJson(res, 503, { error: quotaError, quotaExhausted: true }, auth.cookie ? [auth.cookie] : [])
      return
    }
    sendJson(res, 200, {
      ok: true,
      updated,
      failed,
      quotaExhausted: Boolean(quotaError),
      ...(quotaError ? { error: quotaError } : {}),
      remaining: Math.max(0, pending.length - updated.length),
    }, auth.cookie ? [auth.cookie] : [])
  } catch (error) {
    console.error('Recipe nutrition backfill failed', error)
    sendJson(res, 500, { error: 'Recipe nutrition could not be filled in.' })
  }
}

// Fills in missing nutrition for TODAY's food entries. GET reports how many entries
// are incomplete; POST estimates and saves them. Values the user already recorded are
// never overwritten — only null columns are written, so this is safe to re-run.
async function handleFoodNutrition(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    methodNotAllowed(res, ['GET', 'POST'])
    return
  }
  res.setHeader('Cache-Control', 'no-store')
  try {
    const auth = await authenticatedUser(req)
    if (!auth) {
      sendJson(res, 401, { error: 'Sign in to fill in food nutrition.' })
      return
    }
    await ensureNutrientSchema()
    const db = sql()
    // Scope by the trailing 24 hours rather than the calendar day. Just after local
    // midnight a "today only" window is empty, so the button would appear to do
    // nothing for the meals you just ate — the same boundary problem the rolling
    // metric exists to solve.
    const pending = await db`
      SELECT id, description, portion, calories_kcal, protein_g, carbs_g, fat_g, fiber_g, nutrients
      FROM food_entries
      WHERE user_id = ${auth.id}
        AND occurred_at > now() - interval '24 hours'
        AND occurred_at <= now()
        AND btrim(coalesce(description, '')) <> ''
        AND (calories_kcal IS NULL OR protein_g IS NULL OR carbs_g IS NULL
             OR fat_g IS NULL OR fiber_g IS NULL
             OR nutrients IS NULL OR nutrients = '{}'::jsonb)
      ORDER BY occurred_at ASC
      LIMIT 50
    `
    if (req.method === 'GET') {
      sendJson(res, 200, { pending: pending.length, entries: pending.map((e) => ({ id: e.id, description: e.description })) }, auth.cookie ? [auth.cookie] : [])
      return
    }

    const body = unwrap(req.body)
    const requestedId = text(body.entryId ?? body.entry_id) || ''
    const batch = requestedId ? pending.filter((e) => String(e.id) === requestedId) : pending.slice(0, batchSize(body.limit))
    const updated = []
    const failed = []
    let quotaError = ''
    for (const entry of batch) {
      try {
        const estimate = await estimateFoodNutrition({
          description: entry.description,
          portion: entry.portion,
          calories: finite(entry.calories_kcal),
          protein: finite(entry.protein_g),
          carbs: finite(entry.carbs_g),
          fat: finite(entry.fat_g),
          fiber: finite(entry.fiber_g),
        })
        // Merge, never clobber: the user's own numbers win, AI only fills the gaps.
        const merged = normalizeNutrients({ ...estimate.nutrients, ...(entry.nutrients || {}) })
        const cols = nutrientColumns(merged)
        const rows = await db`
          UPDATE food_entries SET
            calories_kcal = coalesce(calories_kcal, ${estimate.calories}),
            protein_g = coalesce(protein_g, ${estimate.protein}),
            carbs_g = coalesce(carbs_g, ${estimate.carbs}),
            fat_g = coalesce(fat_g, ${estimate.fat}),
            fiber_g = coalesce(fiber_g, ${estimate.fiber}),
            sugars_g = coalesce(sugars_g, ${cols.sugarsG}),
            added_sugars_g = coalesce(added_sugars_g, ${cols.addedSugarsG}),
            sodium_mg = coalesce(sodium_mg, ${cols.sodiumMg}),
            caffeine_mg = coalesce(caffeine_mg, ${cols.caffeineMg}),
            nutrients = ${JSON.stringify(merged)}::jsonb,
            updated_at = now()
          WHERE id = ${entry.id} AND user_id = ${auth.id}
          RETURNING id, description, calories_kcal, protein_g, carbs_g, fat_g, fiber_g
        `
        if (rows.length) updated.push({ id: rows[0].id, description: rows[0].description })
      } catch (error) {
        if (error instanceof NutritionQuotaError) {
          // Every remaining call fails identically; stop rather than burning them.
          quotaError = error.message
          break
        }
        console.error(`Food nutrition estimate failed for ${entry.description}`, error)
        failed.push({ id: entry.id, description: entry.description, error: error instanceof Error ? error.message : 'Estimate failed.' })
      }
    }
    if (quotaError && !updated.length) {
      sendJson(res, 503, { error: quotaError, quotaExhausted: true }, auth.cookie ? [auth.cookie] : [])
      return
    }
    sendJson(res, 200, {
      ok: true,
      updated,
      failed,
      quotaExhausted: Boolean(quotaError),
      ...(quotaError ? { error: quotaError } : {}),
      remaining: Math.max(0, pending.length - updated.length),
    }, auth.cookie ? [auth.cookie] : [])
  } catch (error) {
    console.error('Food nutrition backfill failed', error)
    sendJson(res, 500, { error: 'Food nutrition could not be filled in.' })
  }
}

function servingCount(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 1
  return Math.min(20, Math.round(parsed * 4) / 4)
}
function formatServings(value) {
  return Number.isInteger(value) ? String(value) : String(value)
}
function batchSize(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return 6
  return Math.min(12, Math.round(parsed))
}

async function handleDashboardLayout(req, res) {
  if (!['GET', 'PUT'].includes(req.method)) {
    methodNotAllowed(res, ['GET', 'PUT'])
    return
  }
  res.setHeader('Cache-Control', 'no-store')
  try {
    const auth = await authenticatedUser(req)
    if (!auth) {
      sendJson(res, 401, { error: 'Sign in to manage your dashboard.' })
      return
    }
    const layout = req.method === 'GET'
      ? await getDashboardLayout(auth.id)
      : await saveDashboardLayout(auth.id, unwrap(req.body).layout)
    sendJson(res, 200, { ok: true, layout }, auth.cookie ? [auth.cookie] : [])
  } catch (error) {
    console.error('Fuel dashboard layout request failed', error)
    sendJson(res, 500, { error: 'Unable to save your dashboard layout.' })
  }
}

async function handleUserContext(req, res) {
  if (!['GET', 'PUT'].includes(req.method)) {
    methodNotAllowed(res, ['GET', 'PUT'])
    return
  }
  try {
    const auth = await authenticatedUser(req)
    if (!auth) {
      sendJson(res, 401, { error: 'Sign in to manage Fuel context.' })
      return
    }
    const result = req.method === 'GET'
      ? await getUserContext(auth.id)
      : await saveUserContext(auth.id, unwrap(req.body).context)
    sendJson(res, 200, { ok: true, ...result }, auth.cookie ? [auth.cookie] : [])
  } catch (error) {
    console.error('Fuel user context request failed', error)
    sendJson(res, 500, { error: error instanceof Error ? error.message : 'Unable to update Fuel context.' })
  }
}

// Rolling 24-hour energy balance: calories eaten minus calories burned across the
// trailing 24 hours from right now, rather than since local midnight. A negative
// balance is a deficit, matching the rest of the app.
async function getRolling24h(userId) {
  try {
    return await readRolling24h(userId)
  } catch (error) {
    console.error('Rolling 24h energy unavailable', error)
    return null
  }
}

async function readRolling24h(userId) {
  const db = sql()
  const tz = TIME_ZONE
  // Consumed is exact — food entries carry timestamps, so we just sum the window.
  const consumedRows = await db`
    SELECT coalesce(sum(calories_kcal), 0)::double precision AS consumed, count(calories_kcal)::int AS n
    FROM food_entries
    WHERE user_id = ${userId}
      AND occurred_at > now() - interval '24 hours'
      AND occurred_at <= now()
  `
  const consumed = Math.max(0, finite(consumedRows[0]?.consumed) || 0)
  const foodCount = consumedRows[0]?.n || 0

  // Burned is harder: expenditure accrues continuously and health_energy_snapshots
  // store the running WITHIN-DAY total (reset at local midnight). A 24h window crosses
  // one midnight, so burned = today's total so far + (yesterday's final − yesterday's
  // total at this same clock time). If snapshots are too sparse, fall back to
  // pro-rating the daily health_daily totals across the window.
  let burned = null
  let method = 'none'
  try {
    const snap = await db`
      WITH p AS (SELECT (now() AT TIME ZONE ${tz})::date AS today, ((now() AT TIME ZONE ${tz})::date - 1) AS yday)
      SELECT
        (SELECT s.total_expenditure_kcal FROM health_energy_snapshots s, p
           WHERE s.user_id = ${userId} AND s.date = p.today AND s.total_expenditure_kcal IS NOT NULL
           ORDER BY s.collected_at DESC LIMIT 1) AS today_latest,
        (SELECT s.total_expenditure_kcal FROM health_energy_snapshots s, p
           WHERE s.user_id = ${userId} AND s.date = p.yday AND s.total_expenditure_kcal IS NOT NULL
           ORDER BY s.collected_at DESC LIMIT 1) AS yday_final,
        (SELECT s.total_expenditure_kcal FROM health_energy_snapshots s, p
           WHERE s.user_id = ${userId} AND s.date = p.yday AND s.total_expenditure_kcal IS NOT NULL
           ORDER BY abs(extract(epoch FROM (s.collected_at - (now() - interval '24 hours')))) ASC LIMIT 1) AS yday_at_cutoff
    `
    const todayLatest = finite(snap[0]?.today_latest)
    const ydayFinal = finite(snap[0]?.yday_final)
    const ydayAtCutoff = finite(snap[0]?.yday_at_cutoff)
    if (todayLatest != null && ydayFinal != null && ydayAtCutoff != null) {
      burned = todayLatest + Math.max(0, ydayFinal - ydayAtCutoff)
      method = 'measured'
    }
  } catch (error) {
    // The snapshots table is optional; fall through to the daily-total estimate.
    console.warn('Rolling 24h snapshot path unavailable', error?.message || error)
  }

  if (burned == null) {
    const daily = await db`
      WITH p AS (SELECT (now() AT TIME ZONE ${tz})::date AS today, ((now() AT TIME ZONE ${tz})::date - 1) AS yday)
      SELECT
        (SELECT total_expenditure_kcal FROM health_daily h, p WHERE h.user_id = ${userId} AND h.date = p.today) AS today_total,
        (SELECT total_expenditure_kcal FROM health_daily h, p WHERE h.user_id = ${userId} AND h.date = p.yday) AS yday_total,
        extract(epoch FROM (now() - ((now() AT TIME ZONE ${tz})::date::timestamp AT TIME ZONE ${tz}))) AS secs_today
    `
    const todayTotal = finite(daily[0]?.today_total)
    const ydayTotal = finite(daily[0]?.yday_total)
    const fracToday = Math.min(1, Math.max(0, (finite(daily[0]?.secs_today) || 0) / 86400))
    if (todayTotal != null || ydayTotal != null) {
      // Today's total is the actual amount burned since midnight; yesterday's is
      // pro-rated to the portion of yesterday still inside the window.
      burned = (todayTotal || 0) + (ydayTotal || 0) * (1 - fracToday)
      method = 'estimated'
    }
  }

  if (burned == null) return { consumed, burned: null, balance: null, foodCount, method: 'none' }
  burned = Math.round(burned)
  return { consumed: Math.round(consumed), burned, balance: Math.round(consumed - burned), foodCount, method }
}

async function getIntradayEnergy(userId) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
  try {
    return await readIntradayEnergy(userId, today)
  } catch (error) {
    // Intraday energy is an optional overlay. A missing table or query error must
    // never take down the whole dashboard GET, so degrade to empty series.
    console.error('Intraday energy unavailable', error)
    return { date: today, expenditure: [], consumed: [] }
  }
}

async function readIntradayEnergy(userId, today) {
  const db = sql()
  const [snapshots, foods] = await Promise.all([
    db`
      SELECT collected_at, active_energy_kcal, resting_energy_kcal, total_expenditure_kcal
      FROM health_energy_snapshots
      WHERE user_id = ${userId} AND date = ${today}::date
      ORDER BY collected_at ASC
    `,
    db`
      SELECT occurred_at, calories_kcal
      FROM food_entries
      WHERE user_id = ${userId}
        AND occurred_at >= (${today}::date::timestamp AT TIME ZONE ${TIME_ZONE})
        AND occurred_at < (((${today}::date + interval '1 day')::timestamp) AT TIME ZONE ${TIME_ZONE})
      ORDER BY occurred_at ASC
    `,
  ])

  let consumed = 0
  return {
    date: today,
    expenditure: snapshots.map((row) => ({
      collectedAt: new Date(row.collected_at).toISOString(),
      activeEnergy: finite(row.active_energy_kcal),
      restingEnergy: finite(row.resting_energy_kcal),
      totalExpenditure: finite(row.total_expenditure_kcal),
    })),
    consumed: foods.map((row) => {
      consumed += finite(row.calories_kcal) || 0
      return {
        collectedAt: new Date(row.occurred_at).toISOString(),
        caloriesConsumed: consumed,
      }
    }),
  }
}

function finite(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function routeFromRequest(req) {
  try {
    return new URL(req.url, 'https://fuel.rishib.com').searchParams.get('fuel_route') || ''
  } catch {
    return ''
  }
}

async function authenticatedUser(req) {
  const authorization = String(req.headers.authorization || '')
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (token) {
    const user = await userForSyncToken(token).catch(() => null)
    return user ? { id: user.id, cookie: null } : null
  }

  const { session, cookie } = await authenticatedSession(req)
  if (!session) return null
  return { id: await ensureUserFromSession(session), cookie }
}

function unwrap(body) {
  if (Buffer.isBuffer(body)) return unwrap(body.toString('utf8'))
  if (typeof body === 'string') {
    try { return JSON.parse(body) } catch { return { description: body } }
  }
  return body && typeof body === 'object' ? body : {}
}

function text(value) {
  if (value == null) return null
  const normalized = String(value).trim()
  return normalized || null
}

function number(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

function validDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
