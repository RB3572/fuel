import { ensureUserFromSession } from './db.js'
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

export async function handleMealPlan(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    methodNotAllowed(res, ['GET', 'POST'])
    return
  }
  res.setHeader('Cache-Control', 'no-store')

  try {
    const { session, cookie } = await authenticatedSession(req)
    if (!session) {
      sendJson(res, 401, { error: 'Sign in to Fuel to use the meal planner.' })
      return
    }

    const userId = await ensureUserFromSession(session)
    const [dashboard, savedContext] = await Promise.all([
      getNeonDashboard(userId),
      getUserContext(userId),
    ])
    const budget = mealBudget(dashboard)
    const connected = hasGoogleScope(session, geminiGoogleScope)
    const base = {
      connected,
      connectUrl: `${appUrl()}/api/auth/google/start?gemini=1&return_to=${encodeURIComponent('/meal-plan.html')}`,
      budget,
      contextUpdatedAt: savedContext.updatedAt,
    }

    if (req.method === 'GET') {
      sendJson(res, 200, base, cookie ? [cookie] : [])
      return
    }

    if (!connected) {
      sendJson(res, 409, {
        ...base,
        code: 'gemini_not_connected',
        error: 'Connect your Google account with Gemini access before generating a plan.',
      }, cookie ? [cookie] : [])
      return
    }

    const body = parseBody(req.body)
    const location = validatedLocation(body)
    const localTime = limitedText(body.localTime, 100) || new Date().toISOString()
    const timeZone = limitedText(body.timeZone, 100) || 'America/Los_Angeles'
    const result = await generateMealPlan({
      session,
      dashboard,
      context: savedContext.context,
      budget,
      location,
      localTime,
      timeZone,
    })

    sendJson(res, 200, {
      ...base,
      plan: result.text,
      sources: result.sources,
      model: result.model,
      locationUsed: Boolean(location),
      generatedAt: new Date().toISOString(),
    }, cookie ? [cookie] : [])
  } catch (error) {
    console.error('Fuel Gemini meal planner failed', error)
    sendJson(res, error.statusCode || 500, {
      error: error instanceof Error ? error.message : 'Unable to generate a meal plan.',
      code: error.code || 'meal_plan_failed',
    })
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

async function generateMealPlan({ session, dashboard, context, budget, location, localTime, timeZone }) {
  const model = process.env.GEMINI_MEAL_PLAN_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL
  const quotaProject = googleQuotaProject()
  const prompt = buildPrompt({ dashboard, context, budget, location, localTime, timeZone })
  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.35,
      topP: 0.9,
      maxOutputTokens: 2200,
    },
  }

  if (location) {
    requestBody.tools = [{ googleMaps: {} }]
    requestBody.toolConfig = {
      retrievalConfig: {
        latLng: {
          latitude: location.latitude,
          longitude: location.longitude,
        },
      },
    }
  }

  const response = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.tokens.accessToken}`,
      'Content-Type': 'application/json',
      'x-goog-user-project': quotaProject,
    },
    body: JSON.stringify(requestBody),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = payload?.error?.message || payload?.error || `Gemini request failed with status ${response.status}.`
    const error = new Error(response.status === 403
      ? `${message} Enable the Generative Language API for the OAuth project and ensure this Google account can use that project.`
      : message)
    error.statusCode = response.status >= 400 && response.status < 500 ? response.status : 502
    error.code = response.status === 403 ? 'gemini_permission_denied' : 'gemini_request_failed'
    throw error
  }

  const candidate = payload?.candidates?.[0]
  const text = candidate?.content?.parts?.map((part) => part?.text || '').join('\n').trim()
  if (!text) {
    const error = new Error(payload?.promptFeedback?.blockReason
      ? `Gemini blocked the request: ${payload.promptFeedback.blockReason}.`
      : 'Gemini returned an empty meal plan.')
    error.statusCode = 502
    error.code = 'gemini_empty_response'
    throw error
  }

  const sources = []
  const seen = new Set()
  for (const chunk of candidate?.groundingMetadata?.groundingChunks || []) {
    const map = chunk?.maps
    if (!map?.uri || seen.has(map.uri)) continue
    seen.add(map.uri)
    sources.push({ title: map.title || 'Google Maps place', url: map.uri, placeId: map.placeId || null })
  }
  return { text, sources, model }
}

function buildPrompt({ dashboard, context, budget, location, localTime, timeZone }) {
  const foods = (dashboard?.today?.foodEntries || []).map((entry) =>
    `- ${entry.time || 'Today'}: ${entry.food || entry.meal || 'Food'} (${numberLabel(entry.calories)} kcal, ${numberLabel(entry.protein)} g protein, ${numberLabel(entry.carbs)} g carbs, ${numberLabel(entry.fat)} g fat, ${numberLabel(entry.fiber)} g fiber)`
  ).join('\n') || '- No foods are logged today.'
  const recipes = (dashboard?.recipes || []).slice(0, 30).map((recipe) =>
    `- ${recipe.name}: ${numberLabel(recipe.nutrition?.calories)} kcal, ${numberLabel(recipe.nutrition?.protein)} g protein per ${recipe.serving || 'saved serving'}`
  ).join('\n') || '- No saved recipes.'
  const locationText = location
    ? `Latitude ${location.latitude.toFixed(5)}, longitude ${location.longitude.toFixed(5)}, accuracy about ${Math.round(location.accuracy || 0)} meters. Use Google Maps grounding for nearby restaurant or grocery options.`
    : 'The user did not provide location. Do not invent nearby businesses.'

  return `You are Fuel's meal-planning assistant. Create a practical meal plan for the REST OF TODAY only.

Current local time: ${localTime}
Time zone: ${timeZone}
Location: ${locationText}

TODAY'S NUTRITION BUDGET
- Daily calorie goal: ${numberLabel(budget.caloriesGoal)} kcal
- Calories consumed: ${numberLabel(budget.caloriesConsumed)} kcal
- Calories remaining: ${numberLabel(budget.caloriesRemaining)} kcal
- Protein remaining: ${numberLabel(budget.proteinRemaining)} g
- Carbohydrates remaining: ${numberLabel(budget.carbsRemaining)} g
- Fat remaining: ${numberLabel(budget.fatRemaining)} g
- Fiber remaining: ${numberLabel(budget.fiberRemaining)} g
- Active energy so far: ${numberLabel(budget.activeEnergy)} kcal
- Total expenditure so far: ${numberLabel(budget.totalExpenditure)} kcal

SAVED USER CONTEXT
${limitedText(context, 12000) || 'No saved context.'}

FOOD ALREADY LOGGED TODAY
${foods}

SAVED FUEL RECIPES
${recipes}

REQUIREMENTS
1. Treat allergies and food restrictions in saved context as hard constraints. Never recommend a food merely because it is probably safe. For restaurants, explicitly say the user must verify ingredients and cross-contact with the restaurant.
2. Keep the proposed total close to the remaining calorie budget, normally within 10%, without encouraging compensatory restriction or exercise.
3. Prioritize remaining protein and fiber while preserving useful carbohydrates for training and recovery.
4. Use vegetarian options. Do not recommend meat or fish.
5. Include specific portions and estimated calories, protein, carbs, fat, and fiber for every item.
6. Use saved recipes when they fit. When location is available, include at most two genuinely relevant nearby restaurant or grocery alternatives grounded in Google Maps.
7. If very few calories remain, give a hunger-guided light option and explain that exceeding the target modestly is preferable to unsafe restriction.
8. Do not claim restaurant allergen safety or exact nutrition unless verified.

FORMAT
Use concise plain text with these exact headings:
MEAL PLAN FOR THE REST OF TODAY
BUDGET
PLAN
OPTIONAL LOCAL ALTERNATIVES
ESTIMATED PLAN TOTAL
WHY THIS FITS

Under PLAN, number each eating occasion and include a suggested time. Under ESTIMATED PLAN TOTAL, state total calories and macros and compare them with the remaining targets.`
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
  const text = String(value ?? '').trim()
  return text.slice(0, maximum)
}

function numberLabel(value) {
  const number = finite(value)
  return number == null ? 'not logged' : Math.round(number * 10) / 10
}
