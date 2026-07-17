import { ensureUserFromSession, sql } from './db.js'
import {
  appUrl,
  authenticatedSession,
  geminiGoogleScope,
  googleQuotaProject,
  hasGoogleScope,
} from './google.js'
import { methodNotAllowed, sendJson } from './http.js'
import { getNeonDashboard } from './neon-dashboard.js'
import { getUserContext } from './user-context.js'

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
const DEFAULT_MODEL = 'gemini-2.5-flash'
const TIME_ZONE = 'America/Los_Angeles'
const MAX_MESSAGES = 18
const CHAT_RETENTION_MS = 2 * 24 * 60 * 60 * 1000 // Keep chat history for two days.

export async function handleMealPlan(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    methodNotAllowed(res, ['GET', 'POST'])
    return
  }
  res.setHeader('Cache-Control', 'no-store')

  try {
    const { session, cookie } = await authenticatedSession(req)
    if (!session) {
      sendJson(res, 401, {
        error: 'Sign in to Fuel to use the meal planner.',
        signInUrl: `${appUrl()}/api/auth/google/start?return_to=${encodeURIComponent('/meal-plan.html')}`,
      })
      return
    }

    const userId = await ensureUserFromSession(session)
    await ensureMealPlanTable()
    const state = await currentState(userId)
    const cache = await getCachedPlan(userId)
    const validCache = Boolean(cache?.plan && cache.food_fingerprint === state.foodFingerprint)
    const base = responseBase(state, validCache ? cache : null)

    if (req.method === 'GET') {
      sendJson(res, 200, base, cookie ? [cookie] : [])
      return
    }

    const body = parseBody(req.body)
    const action = String(body.action || 'plan')
    if (action === 'chat') {
      const message = limitedText(body.message, 3000)
      if (!message) {
        sendJson(res, 422, { error: 'A message is required.' })
        return
      }
      if (!validCache) {
        sendJson(res, 409, { ...base, code: 'plan_stale', error: 'Food has changed since this plan was created. Fuel needs to refresh the plan first.' })
        return
      }
      const answer = await answerChat({ session, state, cache, message })
      const messages = appendMessages(cache.messages, [
        { role: 'user', text: message, at: new Date().toISOString() },
        { role: 'assistant', text: answer.text, at: new Date().toISOString() },
      ])
      const saved = await saveCachedPlan(userId, {
        foodFingerprint: state.foodFingerprint,
        plan: cache.plan,
        messages,
        sources: cache.sources,
        model: answer.model,
        generatedAt: cache.generated_at || new Date(),
      })
      sendJson(res, 200, {
        ...responseBase(state, saved),
        reply: answer.text,
      }, cookie ? [cookie] : [])
      return
    }

    if (validCache) {
      sendJson(res, 200, { ...base, cached: true }, cookie ? [cookie] : [])
      return
    }

    const location = validatedLocation(body)
    const localTime = limitedText(body.localTime, 100) || new Date().toString()
    const timeZone = limitedText(body.timeZone, 100) || TIME_ZONE
    const generated = await generateMealPlan({ session, state, location, localTime, timeZone })
    // Regenerating the plan (new food logged, or a new day) must NOT wipe the
    // conversation. Carry the prior chat forward, dropping only entries older
    // than the two-day retention window.
    const saved = await saveCachedPlan(userId, {
      foodFingerprint: state.foodFingerprint,
      plan: generated.text,
      messages: keepRecentMessages(cache?.messages),
      sources: generated.sources,
      model: generated.model,
      generatedAt: new Date(),
    })

    sendJson(res, 200, {
      ...responseBase(state, saved),
      cached: false,
      locationUsed: Boolean(location),
    }, cookie ? [cookie] : [])
  } catch (error) {
    console.error('Fuel Gemini meal planner failed', error)
    const code = error.code || 'meal_plan_failed'
    sendJson(res, error.statusCode || 500, {
      error: error instanceof Error ? error.message : 'Unable to generate a meal plan.',
      code,
      ...(code === 'gemini_scope_missing' ? {
        reauthorizeUrl: `${appUrl()}/api/auth/google/start?return_to=${encodeURIComponent('/meal-plan.html')}`,
      } : {}),
    })
  }
}

async function currentState(userId) {
  const [dashboard, savedContext] = await Promise.all([
    getNeonDashboard(userId),
    getUserContext(userId),
  ])
  const budget = mealBudget(dashboard)
  const foodState = await getFoodState(userId, budget.date)
  return {
    dashboard,
    context: savedContext.context,
    contextUpdatedAt: savedContext.updatedAt,
    budget,
    foodFingerprint: foodState.fingerprint,
    latestFoodAt: foodState.latestFoodAt,
    foodCount: foodState.foodCount,
  }
}

function responseBase(state, cache) {
  return {
    budget: state.budget,
    contextUpdatedAt: state.contextUpdatedAt,
    latestFoodAt: state.latestFoodAt,
    foodCount: state.foodCount,
    needsGeneration: !cache,
    plan: cache?.plan || null,
    messages: keepRecentMessages(cache?.messages),
    sources: normalizeSources(cache?.sources),
    model: cache?.model || null,
    generatedAt: cache?.generated_at || cache?.generatedAt || null,
  }
}

async function ensureMealPlanTable() {
  const db = sql()
  await db`
    CREATE TABLE IF NOT EXISTS meal_plan_sessions (
      user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
      food_fingerprint text NOT NULL DEFAULT '',
      plan text NOT NULL DEFAULT '',
      messages jsonb NOT NULL DEFAULT '[]'::jsonb,
      sources jsonb NOT NULL DEFAULT '[]'::jsonb,
      model text,
      generated_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `
}

async function getCachedPlan(userId) {
  const db = sql()
  const rows = await db`
    SELECT food_fingerprint, plan, messages, sources, model, generated_at, updated_at
    FROM meal_plan_sessions
    WHERE user_id = ${userId}
    LIMIT 1
  `
  return rows[0] || null
}

async function saveCachedPlan(userId, value) {
  const db = sql()
  const rows = await db`
    INSERT INTO meal_plan_sessions (
      user_id, food_fingerprint, plan, messages, sources, model, generated_at, updated_at
    ) VALUES (
      ${userId}, ${value.foodFingerprint}, ${value.plan}, ${JSON.stringify(normalizeMessages(value.messages))}::jsonb,
      ${JSON.stringify(normalizeSources(value.sources))}::jsonb, ${value.model || null}, ${new Date(value.generatedAt).toISOString()}, now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      food_fingerprint = EXCLUDED.food_fingerprint,
      plan = EXCLUDED.plan,
      messages = EXCLUDED.messages,
      sources = EXCLUDED.sources,
      model = EXCLUDED.model,
      generated_at = EXCLUDED.generated_at,
      updated_at = now()
    RETURNING food_fingerprint, plan, messages, sources, model, generated_at, updated_at
  `
  return rows[0]
}

async function getFoodState(userId, dateText) {
  const date = dateText || new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
  const db = sql()
  const rows = await db`
    SELECT
      count(*)::int AS food_count,
      max(updated_at) AS latest_updated_at,
      max(occurred_at) AS latest_food_at,
      coalesce(sum(calories_kcal), 0)::double precision AS calorie_sum
    FROM food_entries
    WHERE user_id = ${userId}
      AND occurred_at >= (${date}::date::timestamp AT TIME ZONE ${TIME_ZONE})
      AND occurred_at < ((${date}::date + interval '1 day')::timestamp AT TIME ZONE ${TIME_ZONE})
  `
  const row = rows[0] || {}
  const fingerprint = JSON.stringify({
    date,
    count: Number(row.food_count || 0),
    latestUpdatedAt: row.latest_updated_at ? new Date(row.latest_updated_at).toISOString() : null,
    latestFoodAt: row.latest_food_at ? new Date(row.latest_food_at).toISOString() : null,
    calorieSum: Math.round(Number(row.calorie_sum || 0) * 100) / 100,
  })
  return {
    fingerprint,
    foodCount: Number(row.food_count || 0),
    latestFoodAt: row.latest_food_at || null,
  }
}

function mealBudget(dashboard) {
  const summary = dashboard?.today?.summary || {}
  const target = (key, fallback = 0) => finite(dashboard?.goals?.[key]?.target) ?? fallback
  const consumed = (key) => finite(summary[key]) ?? 0
  const caloriesGoal = target('calories')
  const caloriesConsumed = consumed('caloriesConsumed')
  return {
    date: summary.date || null,
    caloriesGoal,
    caloriesConsumed,
    caloriesRemaining: Math.max(0, caloriesGoal - caloriesConsumed),
    proteinGoal: target('protein'),
    proteinConsumed: consumed('protein'),
    proteinRemaining: Math.max(0, target('protein') - consumed('protein')),
    carbsGoal: target('carbs'),
    carbsConsumed: consumed('carbs'),
    carbsRemaining: Math.max(0, target('carbs') - consumed('carbs')),
    fatGoal: target('fat'),
    fatConsumed: consumed('fat'),
    fatRemaining: Math.max(0, target('fat') - consumed('fat')),
    fiberGoal: target('fiber'),
    fiberConsumed: consumed('fiber'),
    fiberRemaining: Math.max(0, target('fiber') - consumed('fiber')),
    activeEnergy: finite(summary.activeEnergy),
    totalExpenditure: finite(summary.totalExpenditure),
  }
}

async function generateMealPlan({ session, state, location, localTime, timeZone }) {
  const model = process.env.GEMINI_MEAL_PLAN_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL
  const prompt = buildPlanPrompt({ ...state, location, localTime, timeZone })
  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.35, topP: 0.9, maxOutputTokens: 2200 },
  }
  if (location) {
    requestBody.tools = [{ googleMaps: {} }]
    requestBody.toolConfig = { retrievalConfig: { latLng: { latitude: location.latitude, longitude: location.longitude } } }
  }
  const payload = await callGemini(session, model, requestBody, Boolean(location))
  const candidate = payload?.candidates?.[0]
  const text = candidate?.content?.parts?.map((part) => part?.text || '').join('\n').trim()
  if (!text) throw geminiError(payload?.promptFeedback?.blockReason ? `Gemini blocked the request: ${payload.promptFeedback.blockReason}.` : 'Gemini returned an empty meal plan.', 502, 'gemini_empty_response')
  return { text, sources: groundingSources(candidate), model }
}

async function answerChat({ session, state, cache, message }) {
  const model = process.env.GEMINI_MEAL_PLAN_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL
  const prior = normalizeMessages(cache.messages).slice(-MAX_MESSAGES)
  const contents = [
    { role: 'user', parts: [{ text: buildChatContext(state) }] },
    { role: 'model', parts: [{ text: cache.plan }] },
    ...prior.map((item) => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.text }] })),
    { role: 'user', parts: [{ text: message }] },
  ]
  const payload = await callGemini(session, model, {
    contents,
    generationConfig: { temperature: 0.35, topP: 0.9, maxOutputTokens: 900 },
  })
  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('\n').trim()
  if (!text) throw geminiError('Gemini returned an empty response.', 502, 'gemini_empty_response')
  return { text, model }
}

async function callGemini(session, model, requestBody, allowMapsFallback = false) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''
  if (!apiKey && !hasGoogleScope(session, geminiGoogleScope)) {
    throw geminiError('Your existing Fuel Google session needs to be refreshed once so it includes Gemini access.', 403, 'gemini_scope_missing')
  }
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) {
    headers['x-goog-api-key'] = apiKey
  } else {
    headers.Authorization = `Bearer ${session.tokens.accessToken}`
    headers['x-goog-user-project'] = googleQuotaProject()
  }

  const invoke = async (body) => {
    const response = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers, body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({}))
    return { response, payload }
  }

  let result = await invoke(requestBody)
  if (!result.response.ok && allowMapsFallback && requestBody.tools) {
    const fallback = { ...requestBody }
    delete fallback.tools
    delete fallback.toolConfig
    result = await invoke(fallback)
  }
  if (!result.response.ok) {
    const message = result.payload?.error?.message || result.payload?.error || `Gemini request failed with status ${result.response.status}.`
    const code = result.response.status === 403 ? 'gemini_permission_denied' : 'gemini_request_failed'
    throw geminiError(String(message), result.response.status >= 400 && result.response.status < 500 ? result.response.status : 502, code)
  }
  return result.payload
}

function buildPlanPrompt({ dashboard, context, budget, location, localTime, timeZone }) {
  const entries = dashboard?.today?.foodEntries || []
  const foods = entries.map((entry) =>
    `- ${entry.time || 'Today'} | ${entry.meal || 'Uncategorized'} | ${entry.food || 'Food'}: ${numberLabel(entry.calories)} kcal, ${numberLabel(entry.protein)} g protein, ${numberLabel(entry.carbs)} g carbs, ${numberLabel(entry.fat)} g fat, ${numberLabel(entry.fiber)} g fiber`
  ).join('\n') || '- No foods are logged today.'
  const recipes = (dashboard?.recipes || []).slice(0, 30).map((recipe) =>
    `- ${recipe.name}: ${numberLabel(recipe.nutrition?.calories)} kcal and ${numberLabel(recipe.nutrition?.protein)} g protein per ${recipe.serving || 'saved serving'}`
  ).join('\n') || '- No saved recipes.'
  const schedule = scheduleGuidance(localTime, entries)
  const locationText = location
    ? `Latitude ${location.latitude.toFixed(5)}, longitude ${location.longitude.toFixed(5)}, accuracy about ${Math.round(location.accuracy || 0)} meters. Use location only for genuinely useful nearby options.`
    : 'Location was unavailable. Do not invent nearby businesses.'

  return `You are Fuel's meal-planning assistant. Create a practical meal plan for the REST OF TODAY only.

CURRENT CONTEXT
- Local time: ${localTime}
- Time zone: ${timeZone}
- Location: ${locationText}
- Schedule instruction: ${schedule}

REMAINING NUTRITION
- Calories: ${numberLabel(budget.caloriesRemaining)} kcal remaining of ${numberLabel(budget.caloriesGoal)}
- Protein: ${numberLabel(budget.proteinRemaining)} g remaining
- Carbohydrates: ${numberLabel(budget.carbsRemaining)} g remaining
- Fat: ${numberLabel(budget.fatRemaining)} g remaining
- Fiber: ${numberLabel(budget.fiberRemaining)} g remaining
- Active energy so far: ${numberLabel(budget.activeEnergy)} kcal
- Total expenditure so far: ${numberLabel(budget.totalExpenditure)} kcal

SAVED USER CONTEXT
${limitedText(context, 12000) || 'No saved context.'}

FOOD LOGGED TODAY
${foods}

SAVED FUEL RECIPES
${recipes}

RULES
1. Treat allergies and dietary restrictions as hard constraints. Never claim a restaurant is allergen-safe; say to verify ingredients and cross-contact.
2. Plan only eating occasions that are still relevant at the current local time. Use the schedule instruction and logged meal categories. Do not recommend breakfast after breakfast time unless the user has specifically missed it and it remains practical.
3. Keep the proposed total close to the remaining calorie budget, usually within 10%, without encouraging unsafe restriction or compensatory exercise.
4. Prioritize remaining protein and fiber while preserving useful carbohydrates for training and recovery.
5. Use vegetarian options. Include portions and estimated calories, protein, carbs, fat, and fiber.
6. Use saved recipes when they fit. Include at most two location-aware alternatives.
7. If very few calories remain, provide a hunger-guided light option and state that modestly exceeding the goal is preferable to unsafe restriction.

Use concise plain text with these exact headings:
MEAL PLAN FOR THE REST OF TODAY
BUDGET
PLAN
OPTIONAL LOCAL ALTERNATIVES
ESTIMATED PLAN TOTAL
WHY THIS FITS

Under PLAN, number each remaining eating occasion and provide an appropriate local time.`
}

function buildChatContext(state) {
  return `Continue as Fuel's meal-planning assistant. Answer changes and questions about the current plan concisely. Preserve hard allergy and dietary constraints. Current remaining budget is ${numberLabel(state.budget.caloriesRemaining)} kcal, ${numberLabel(state.budget.proteinRemaining)} g protein, ${numberLabel(state.budget.carbsRemaining)} g carbs, ${numberLabel(state.budget.fatRemaining)} g fat, and ${numberLabel(state.budget.fiberRemaining)} g fiber. Saved context:\n${limitedText(state.context, 10000)}`
}

function scheduleGuidance(localTime, entries) {
  const date = new Date(localTime)
  const hour = Number.isNaN(date.getTime()) ? new Date().getHours() : date.getHours()
  const meals = new Set(entries.map((entry) => String(entry.meal || '').toLowerCase()))
  const has = (name) => [...meals].some((meal) => meal.includes(name))
  if (hour < 9) {
    return `It is morning. ${has('breakfast') ? 'Breakfast is already logged.' : 'Include breakfast.'} ${has('lunch') ? 'Lunch is already logged.' : 'Include lunch.'} ${has('dinner') ? 'Dinner is already logged.' : 'Include dinner.'}`
  }
  if (hour < 14) {
    return `It is late morning or early afternoon. ${has('lunch') ? 'Lunch is already logged.' : 'Include lunch soon.'} ${has('dinner') ? 'Dinner is already logged.' : 'Include dinner later.'} Add a snack only if it helps the remaining targets.`
  }
  if (hour < 18) {
    return `It is afternoon. ${has('dinner') ? 'Dinner is already logged, so focus on a useful snack or dessert only if needed.' : 'Recommend dinner at an appropriate upcoming time.'}`
  }
  if (hour < 22) {
    return `It is evening. ${has('dinner') ? 'Dinner is already logged; recommend only a remaining snack or dessert if useful.' : 'Recommend dinner now or soon, plus only a later snack if the budget supports it.'}`
  }
  return `It is late evening. Do not propose a full day of meals. ${has('dinner') ? 'Dinner is already logged.' : 'Offer one practical late dinner only if hunger and the remaining budget justify it.'} Otherwise offer a light snack.`
}

function groundingSources(candidate) {
  const sources = []
  const seen = new Set()
  for (const chunk of candidate?.groundingMetadata?.groundingChunks || []) {
    const map = chunk?.maps
    if (!map?.uri || seen.has(map.uri)) continue
    seen.add(map.uri)
    sources.push({ title: map.title || 'Google Maps place', url: map.uri, placeId: map.placeId || null })
  }
  return sources
}

function appendMessages(existing, additions) {
  return keepRecentMessages([...normalizeMessages(existing), ...additions])
}

// Normalize, then drop messages older than the two-day retention window and cap
// the total. Entries without a timestamp are always kept.
function keepRecentMessages(value) {
  const cutoff = Date.now() - CHAT_RETENTION_MS
  return normalizeMessages(value).filter((item) => {
    if (!item.at) return true
    const at = new Date(item.at).getTime()
    return Number.isNaN(at) || at >= cutoff
  }).slice(-MAX_MESSAGES)
}

function normalizeMessages(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => ({
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    text: limitedText(item?.text, 5000),
    at: item?.at || null,
  })).filter((item) => item.text)
}

function normalizeSources(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => ({ title: limitedText(item?.title, 300), url: limitedText(item?.url, 1500), placeId: limitedText(item?.placeId, 300) || null })).filter((item) => item.url)
}

function validatedLocation(body) {
  const latitude = finite(body.latitude)
  const longitude = finite(body.longitude)
  const accuracy = finite(body.accuracy)
  if (latitude == null || longitude == null) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  return { latitude, longitude, accuracy: accuracy != null && accuracy >= 0 ? accuracy : null }
}

function parseBody(body) {
  if (Buffer.isBuffer(body)) return parseBody(body.toString('utf8'))
  if (typeof body === 'string') {
    try { return JSON.parse(body) } catch { return {} }
  }
  return body && typeof body === 'object' ? body : {}
}

function finite(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function limitedText(value, maximum) {
  return String(value ?? '').trim().slice(0, maximum)
}

function numberLabel(value) {
  const number = finite(value)
  return number == null ? 'not logged' : Math.round(number * 10) / 10
}

function geminiError(message, statusCode, code) {
  const error = new Error(message)
  error.statusCode = statusCode
  error.code = code
  return error
}
