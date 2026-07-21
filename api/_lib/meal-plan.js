import { ensureUserFromSession, sql } from './db.js'
import { appUrl, authenticatedSession } from './google.js'
import { methodNotAllowed, sendJson } from './http.js'
import { getNeonDashboard } from './neon-dashboard.js'
import { appendUserContext, getUserContext, saveUserContext } from './user-context.js'
import { saveUserGoals } from './goals.js'
import { ensureNutrientSchema, NUTRIENT_JSON_SCHEMA_PROPERTIES, normalizeNutrients, nutrientColumns, nutrientSummaryText } from './nutrients.js'

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
// Rolling alias for the current Gemini Flash model. Pinned versions like
// gemini-2.5-flash get retired for new API keys; this alias tracks the latest and
// stays multimodal (needed for photo food logging). Override with GEMINI_MODEL.
const DEFAULT_MODEL = 'gemini-flash-latest'
const TIME_ZONE = 'America/Los_Angeles'
const MAX_MESSAGES = 10 // Chat history is always the most recent 10 messages.
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
const GEMINI_PLAN_TIMEOUT_MS = 18000
const GEMINI_RETRY_TIMEOUT_MS = 12000
const GEMINI_CHAT_TIMEOUT_MS = 25000

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
    await Promise.all([ensureMealPlanTable(), ensureNutrientSchema()])
    const state = await currentState(userId)
    const cache = await getCachedPlan(userId)
    const validCache = Boolean(cache?.plan && cache.food_fingerprint === state.foodFingerprint && planLooksComplete(cache.plan))
    const base = responseBase(state, validCache ? cache : null)

    if (req.method === 'GET') {
      sendJson(res, 200, base, cookie ? [cookie] : [])
      return
    }

    const body = parseBody(req.body)
    const action = String(body.action || 'plan')
    if (action === 'chat') {
      const image = validatedImage(body.image)
      const message = limitedText(body.message, 3000)
      if (!message && !image) {
        sendJson(res, 422, { error: 'A message or a photo is required.' })
        return
      }
      if (!validCache) {
        sendJson(res, 409, { ...base, code: 'plan_stale', error: 'Food has changed since this plan was created. Fuel needs to refresh the plan first.' })
        return
      }
      const location = validatedLocation(body)
      const localTime = limitedText(body.localTime, 100) || new Date().toString()
      const timeZone = limitedText(body.timeZone, 100) || TIME_ZONE
      const answer = await answerChat({ state, cache, message, image })
      if (answer.foods.length) await logFoods(userId, answer.foods)
      let contextResult = null
      if (answer.contextUpdate) {
        contextResult = answer.contextUpdate.mode === 'replace'
? await saveUserContext(userId, answer.contextUpdate.context)
: await appendUserContext(userId, answer.contextUpdate.context)
      }
      let goalsResult = null
      if (Object.keys(answer.goalUpdates).length) goalsResult = await saveUserGoals(userId, { goals: answer.goalUpdates })
      const dataChanged = Boolean(answer.foods.length || contextResult || goalsResult)
      // Regenerate the plan when the diary/goals changed, or when the user asked for a
      // new plan (the model flags it, plus a keyword fallback for reliability).
      const wantsNewPlan = /\b(regenerate|new plan|another plan|different plan|fresh plan|re-?do (the |my )?plan|remake (the |my )?plan|make (me )?(a |another )?(new )?plan)\b/i.test(message)
      const regenerate = dataChanged || answer.regeneratePlan || wantsNewPlan
      const nextState = dataChanged ? await currentState(userId) : state
      // Chat history is never cleared on regeneration: even when a new plan is built,
      // the conversation keeps flowing, capped to the most recent MAX_MESSAGES.
      const messages = appendMessages(cache.messages, [
        { role: 'user', text: message || 'Sent a photo to log.', at: new Date().toISOString() },
        { role: 'assistant', text: answer.text, at: new Date().toISOString() },
      ])
      let updatedPlan = null
      let sources = cache.sources
      let model = answer.model
      let plan = cache.plan
      let foodFingerprint = regenerate ? nextState.foodFingerprint : state.foodFingerprint
      if (regenerate) {
        const generated = await generateMealPlan({ state: nextState, location, localTime, timeZone })
        updatedPlan = generated.text
        plan = generated.text
        sources = generated.sources
        model = generated.model
      }
      const saved = await saveCachedPlan(userId, {
        foodFingerprint,
        plan,
        messages,
        sources,
        model,
        generatedAt: regenerate ? new Date() : cache.generated_at || new Date(),
      })
      sendJson(res, 200, {
        ...responseBase(nextState, saved),
        reply: answer.text,
        loggedFoods: answer.foods,
        contextUpdated: Boolean(contextResult),
        goalsUpdated: Boolean(goalsResult),
        updatedPlan,
        planUpdated: Boolean(updatedPlan),
      }, cookie ? [cookie] : [])
      return
    }

    if (action === 'clear') {
      // Explicit user action from the "Clear chat" button: empty the conversation
      // but keep the current plan and its sources.
      if (cache) {
        await saveCachedPlan(userId, {
          foodFingerprint: cache.food_fingerprint,
          plan: cache.plan,
          messages: [],
          sources: cache.sources,
          model: cache.model,
          generatedAt: cache.generated_at || new Date(),
        })
      }
      sendJson(res, 200, { ...responseBase(state, validCache ? cache : null), messages: [], cleared: true }, cookie ? [cookie] : [])
      return
    }

    // The "New plan" button sends force:true to regenerate even when the cached plan
    // still matches today's food.
    if (validCache && !body.force) {
      sendJson(res, 200, { ...base, cached: true }, cookie ? [cookie] : [])
      return
    }

    const location = validatedLocation(body)
    const localTime = limitedText(body.localTime, 100) || new Date().toString()
    const timeZone = limitedText(body.timeZone, 100) || TIME_ZONE
    const generated = await generateMealPlan({ state, location, localTime, timeZone })
    // A newly generated plan keeps the existing conversation (most recent
    // MAX_MESSAGES); generating a plan is not a reason to wipe chat history.
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
    calorieBalancePercent: target('calorieBalancePercent'),
    averageExpenditure: finite(dashboard?.energyAverages?.totalExpenditure),
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

const PLAN_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    target: { type: 'string' },
    plan: { type: 'string' },
    estimatedPlanTotal: { type: 'string' },
    whyThisFits: { type: 'string' },
  },
  required: ['target', 'plan', 'estimatedPlanTotal', 'whyThisFits'],
}

async function generateMealPlan({ state, location, localTime, timeZone }) {
  const model = process.env.GEMINI_MEAL_PLAN_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL
  const prompt = buildPlanPrompt({ ...state, location, localTime, timeZone })
  const buildRequest = (instruction = '') => ({
    contents: [{ role: 'user', parts: [{ text: `${prompt}${instruction}` }] }],
    generationConfig: {
      temperature: 0.25,
      topP: 0.9,
      maxOutputTokens: 1800,
      responseMimeType: 'application/json',
      responseSchema: PLAN_RESPONSE_SCHEMA,
      // gemini-flash-latest is a thinking model whose reasoning tokens count against
      // maxOutputTokens. Left on, thinking consumes the entire budget and the JSON
      // output is truncated (finishReason MAX_TOKENS) — every plan comes back
      // incomplete. Disable thinking so the whole budget goes to the response.
      thinkingConfig: { thinkingBudget: 0 },
    },
  })

  let payload = await callGemini(model, buildRequest(), false, GEMINI_PLAN_TIMEOUT_MS)
  let parsed = parsePlanPayload(payload)
  if (parsed.candidate?.finishReason === 'MAX_TOKENS' || !parsed.valid) {
    payload = await callGemini(model, buildRequest('\n\nRETRY REQUIREMENTS: Keep the complete response concise. Each required field must be present and end with a complete sentence. The plan field should contain short meal lines with portions and estimates, not a long essay.'), false, GEMINI_RETRY_TIMEOUT_MS)
    parsed = parsePlanPayload(payload)
  }
  if (!parsed.valid) {
    throw geminiError('Fuel AI could not produce a complete meal plan. Please try again.', 502, 'gemini_incomplete_plan')
  }
  const text = formatPlanPayload(parsed)
  return { text, sources: [], model }
}

function parsePlanPayload(payload) {
  const candidate = payload?.candidates?.[0]
  const raw = candidate?.content?.parts?.map((part) => part?.text || '').join('').trim()
  if (!raw) return { valid: false, target: '', plan: '', estimatedPlanTotal: '', whyThisFits: '', candidate }
  try {
    const value = JSON.parse(raw)
    const target = cleanReplyText(value?.target || '')
    const plan = cleanReplyText(value?.plan || '')
    const estimatedPlanTotal = cleanReplyText(value?.estimatedPlanTotal || '')
    const whyThisFits = cleanReplyText(value?.whyThisFits || '')
    const valid = [target, plan, estimatedPlanTotal, whyThisFits].every((field) => field.length >= 8)
    return { valid, target, plan, estimatedPlanTotal, whyThisFits, candidate }
  } catch {
    return { valid: false, target: '', plan: '', estimatedPlanTotal: '', whyThisFits: '', candidate }
  }
}

function formatPlanPayload(value) {
  const whyThisFits = /[.!?)]$/.test(value.whyThisFits) ? value.whyThisFits : `${value.whyThisFits}.`
  return `MEAL PLAN FOR THE REST OF TODAY\n\nTARGET\n${value.target}\n\nPLAN\n${value.plan}\n\nESTIMATED PLAN TOTAL\n${value.estimatedPlanTotal}\n\nWHY THIS FITS\n${whyThisFits}`.trim()
}

export function planLooksComplete(value) {
  const text = cleanReplyText(value)
  if (text.length < 100) return false
  const required = ['MEAL PLAN FOR THE REST OF TODAY', 'TARGET', 'PLAN', 'ESTIMATED PLAN TOTAL', 'WHY THIS FITS']
  if (!required.every((heading) => text.toUpperCase().includes(heading))) return false
  if (!/[.!?)]$/.test(text)) return false
  const opening = (text.match(/\(/g) || []).length
  const closing = (text.match(/\)/g) || []).length
  return opening === closing
}

// Chat answers are structured so one call can both reply conversationally and hand
// back food to write into the diary. `foods` stays empty for ordinary questions.
const CHAT_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    foods: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
description: { type: 'string' }, meal: { type: 'string' }, portion: { type: 'string' },
calories: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' }, fat: { type: 'number' }, fiber: { type: 'number' },
          nutrients: { type: 'object', properties: NUTRIENT_JSON_SCHEMA_PROPERTIES },
        },
        required: ['description', 'calories'],
      },
    },
    contextUpdate: {
      type: 'object',
      properties: { context: { type: 'string' }, mode: { type: 'string', enum: ['append', 'replace'] } },
      required: ['context'],
    },
    goalUpdates: {
      type: 'object',
      properties: {
        calorieBalancePercent: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' }, fat: { type: 'number' }, fiber: { type: 'number' },
        move: { type: 'number' }, exercise: { type: 'number' }, stand: { type: 'number' }, steps: { type: 'number' }, sleepHours: { type: 'number' },
      },
    },
    regeneratePlan: { type: 'boolean' },
  },
  required: ['reply'],
}

async function answerChat({ state, cache, message, image }) {
  const model = process.env.GEMINI_MEAL_PLAN_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL
  const prior = normalizeMessages(cache.messages).slice(-MAX_MESSAGES)
  const parts = []
  if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } })
  parts.push({ text: message || 'Log the food in this photo.' })
  const contents = [
    { role: 'user', parts: [{ text: buildChatContext(state) }] },
    { role: 'model', parts: [{ text: cache.plan }] },
    ...prior.map((item) => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.text }] })),
    { role: 'user', parts },
  ]
  const request = {
    contents,
    // thinkingBudget: 0 — see generateMealPlan. Reasoning tokens would otherwise eat
    // the output budget and truncate the structured chat reply.
    generationConfig: { temperature: 0.3, topP: 0.9, maxOutputTokens: 2800, responseMimeType: 'application/json', responseSchema: CHAT_RESPONSE_SCHEMA, thinkingConfig: { thinkingBudget: 0 } },
  }
  let payload = await callGemini(model, request, false, GEMINI_CHAT_TIMEOUT_MS)
  let candidate = payload?.candidates?.[0]
  let raw = candidate?.content?.parts?.map((part) => part?.text || '').join('').trim()
  let parsed = parseStructuredChatResponse(raw)
  if (!parsed.valid || candidate?.finishReason === 'MAX_TOKENS') {
    payload = await callGemini(model, {
      ...request,
      contents: [...contents, { role: 'model', parts: [{ text: raw || '{}' }] }, { role: 'user', parts: [{ text: 'The prior response was invalid or truncated. Return complete, compact JSON matching the schema. Keep reply under 900 words. Never wrap JSON in a code fence.' }] }],
      generationConfig: { ...request.generationConfig, maxOutputTokens: 2400 },
    }, false, GEMINI_RETRY_TIMEOUT_MS)
    candidate = payload?.candidates?.[0]
    raw = candidate?.content?.parts?.map((part) => part?.text || '').join('').trim()
    parsed = parseStructuredChatResponse(raw)
  }
  if (!parsed.valid) throw geminiError('Fuel AI could not produce a complete response. Please try that message again.', 502, 'gemini_incomplete_response')
  const text = limitedText(cleanReplyText(parsed.reply), 12000)
  if (!text) throw geminiError('Gemini returned an empty response.', 502, 'gemini_empty_response')
  return {
    text,
    foods: normalizeFoods(parsed.foods),
    contextUpdate: normalizeContextUpdate(parsed.contextUpdate),
    goalUpdates: normalizeGoalUpdates(parsed.goalUpdates),
    regeneratePlan: Boolean(parsed.regeneratePlan),
    model,
  }
}

export function parseStructuredChatResponse(value) {
  const raw = stripCodeFence(String(value || '').trim())
  if (!raw) return { valid: false, reply: '', foods: [], contextUpdate: null, goalUpdates: {} }
  try {
    let parsed = JSON.parse(raw)
    for (let index = 0; index < 2 && typeof parsed === 'string'; index += 1) parsed = JSON.parse(parsed)
    if (parsed && typeof parsed === 'object') {
      return { valid: typeof parsed.reply === 'string', reply: parsed.reply || '', foods: parsed.foods || [], contextUpdate: parsed.contextUpdate || null, goalUpdates: parsed.goalUpdates || {}, regeneratePlan: Boolean(parsed.regeneratePlan) }
    }
  } catch { /* extract a safe reply below */ }
  return { valid: false, reply: extractJsonStringField(raw, 'reply') || raw.replace(/^\s*[\[{]+/, '').replace(/[\]}]+\s*$/, ''), foods: [], contextUpdate: null, goalUpdates: {}, regeneratePlan: false }
}

export function cleanReplyText(value) {
  let text = stripCodeFence(String(value || '').trim())
  for (let index = 0; index < 3; index += 1) {
    try {
      const parsed = JSON.parse(text)
      if (typeof parsed === 'string') { text = parsed.trim(); continue }
      if (parsed && typeof parsed.reply === 'string') { text = parsed.reply.trim(); continue }
    } catch { break }
    break
  }
  if (/^\s*\{/.test(text) && /["']reply["']\s*:/.test(text)) text = extractJsonStringField(text, 'reply') || text
  return stripCodeFence(text).replace(/^\s*[\[{]+\s*/, '').replace(/\s*[\]}]+\s*$/, '').trim()
}

function extractJsonStringField(raw, field) {
  const match = new RegExp(`"${field}"\\s*:\\s*"`).exec(raw)
  if (!match) return ''
  let output = ''
  let escaped = false
  for (let index = match.index + match[0].length; index < raw.length; index += 1) {
    const character = raw[index]
    if (escaped) {
      const escapes = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\', '/': '/' }
      if (character === 'u' && /^[0-9a-fA-F]{4}$/.test(raw.slice(index + 1, index + 5))) {
        output += String.fromCharCode(parseInt(raw.slice(index + 1, index + 5), 16)); index += 4
      } else output += escapes[character] ?? character
      escaped = false
    } else if (character === '\\') escaped = true
    else if (character === '"') return output
    else output += character
  }
  return output
}
function stripCodeFence(value) { return String(value || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim() }
function normalizeContextUpdate(value) {
  if (!value || typeof value !== 'object') return null
  const context = limitedText(value.context, 20000)
  return context ? { context, mode: value.mode === 'replace' ? 'replace' : 'append' } : null
}
function normalizeGoalUpdates(value) {
  if (!value || typeof value !== 'object') return {}
  const output = {}
  for (const key of ['calorieBalancePercent','protein','carbs','fat','fiber','move','exercise','stand','steps','sleepHours']) {
    const parsed = finite(value[key])
    if (parsed != null) output[key] = parsed
  }
  return output
}

function normalizeFoods(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => ({
    description: limitedText(item?.description, 300),
    meal: limitedText(item?.meal, 60) || null,
    portion: limitedText(item?.portion, 120) || null,
    calories: nonNegative(item?.calories),
    protein: nonNegative(item?.protein),
    carbs: nonNegative(item?.carbs),
    fat: nonNegative(item?.fat),
    fiber: nonNegative(item?.fiber),
    nutrients: normalizeNutrients(item?.nutrients),
  })).filter((item) => item.description).slice(0, 12)
}

function nonNegative(value) {
  const parsed = finite(value)
  return parsed != null && parsed >= 0 ? parsed : null
}

async function logFoods(userId, foods) {
  const db = sql()
  const occurredAt = new Date().toISOString()
  for (const food of foods) {
    const nutrients = normalizeNutrients(food.nutrients)
    const core = nutrientColumns(nutrients)
    await db`
      INSERT INTO food_entries (
        user_id, occurred_at, meal, description, portion,
        calories_kcal, protein_g, carbs_g, fat_g, fiber_g,
        sugars_g, added_sugars_g, sodium_mg, caffeine_mg, nutrients,
        confidence, notes, source, updated_at
      ) VALUES (
        ${userId}, ${occurredAt}, ${food.meal}, ${food.description}, ${food.portion},
        ${food.calories}, ${food.protein}, ${food.carbs}, ${food.fat}, ${food.fiber},
        ${core.sugarsG}, ${core.addedSugarsG}, ${core.sodiumMg}, ${core.caffeineMg}, ${JSON.stringify(nutrients)}::jsonb,
        'estimated', null, 'Fuel AI chat', now()
      )
    `
  }
}

export async function callGemini(model, requestBody, allowMapsFallback = false, timeoutMs = GEMINI_CHAT_TIMEOUT_MS) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''
  if (!apiKey) {
    throw geminiError('Fuel AI is not configured. Set GEMINI_API_KEY in the deployment environment.', 503, 'gemini_not_configured')
  }
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }

  const invoke = async (body) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
      })
      const payload = await response.json().catch(() => ({}))
      return { response, payload }
    } catch (error) {
      if (error?.name === 'AbortError') throw geminiError('Fuel AI took too long to respond. Please try again.', 504, 'gemini_timeout')
      throw error
    } finally {
      clearTimeout(timer)
    }
  }

  let result = await invoke(requestBody)
  if (!result.response.ok && allowMapsFallback && requestBody.tools) {
    const fallback = { ...requestBody }
    delete fallback.tools
    delete fallback.toolConfig
    result = await invoke(fallback)
  }
  if (!result.response.ok) {
    const providerMessage = String(result.payload?.error?.message || result.payload?.error || `Gemini request failed with status ${result.response.status}.`)
    console.error('Gemini provider error', providerMessage)
    if (/Invalid JSON payload|response_schema|Unknown name \"additionalProperties\"|Cannot find field/i.test(providerMessage)) {
      throw geminiError('Fuel AI response formatting was rejected. Please try again.', 502, 'gemini_schema_rejected')
    }
    const code = result.response.status === 403 ? 'gemini_permission_denied' : 'gemini_request_failed'
    const publicMessage = result.response.status >= 400 && result.response.status < 500 ? 'Fuel AI could not process that request. Please try again.' : 'Fuel AI is temporarily unavailable. Please try again.'
    throw geminiError(publicMessage, result.response.status >= 400 && result.response.status < 500 ? result.response.status : 502, code)
  }
  return result.payload
}

function buildPlanPrompt({ dashboard, context, budget, location, localTime, timeZone }) {
  const entries = dashboard?.today?.foodEntries || []
  const foods = entries.map((entry) => {
    const details = nutrientSummaryText(entry.nutrients)
    return `- ${entry.time || 'Today'} | ${entry.meal || 'Uncategorized'} | ${entry.food || 'Food'}: ${numberLabel(entry.calories)} kcal, ${numberLabel(entry.protein)} g protein, ${numberLabel(entry.carbs)} g carbs, ${numberLabel(entry.fat)} g fat, ${numberLabel(entry.fiber)} g fiber${details ? `; ${details}` : ''}`
  }).join('\n') || '- No foods are logged today.'
  const recipes = (dashboard?.recipes || []).slice(0, 30).map((recipe) => `- ${recipe.name}: ${numberLabel(recipe.nutrition?.calories)} kcal and ${numberLabel(recipe.nutrition?.protein)} g protein per ${recipe.serving || 'saved serving'}`).join('\n') || '- No saved recipes.'
  const schedule = scheduleGuidance(localTime, entries)
  const locationText = location ? `Local coordinates are available for time-zone and general context only. Do not name or invent nearby businesses.` : 'Location was unavailable. Do not invent nearby businesses.'
  return `You are Fuel's meal-planning assistant. Create a practical meal plan for the REST OF TODAY only.

CURRENT CONTEXT
- Local time: ${localTime}
- Time zone: ${timeZone}
- Location: ${locationText}
- Schedule instruction: ${schedule}

CALCULATED DAILY TARGET
- Average daily calories burned: ${numberLabel(budget.averageExpenditure)} kcal
- Goal relative to average: ${numberLabel(budget.calorieBalancePercent)}%
- Calculated calorie target: ${numberLabel(budget.caloriesGoal)} kcal
- Calories remaining: ${numberLabel(budget.caloriesRemaining)} kcal
- Protein remaining: ${numberLabel(budget.proteinRemaining)} g
- Carbohydrates remaining: ${numberLabel(budget.carbsRemaining)} g
- Fat remaining: ${numberLabel(budget.fatRemaining)} g
- Fiber remaining: ${numberLabel(budget.fiberRemaining)} g

COMPLETE HEALTH DATA
${buildHealthSummary(dashboard)}

SAVED USER CONTEXT
${limitedText(context, 12000) || 'No saved context.'}

FOOD LOGGED TODAY
${foods}

SAVED FUEL RECIPES
${recipes}

RULES
1. Treat allergies and dietary restrictions as hard constraints.
2. Plan only eating occasions still relevant at the current local time.
3. Keep the proposed total close to the calculated remaining calorie target without encouraging unsafe restriction.
4. Prioritize remaining protein and fiber while preserving useful carbohydrates for training and recovery.
5. Include portions and estimated calories, protein, carbs, fat, fiber, sodium, caffeine, total and added sugars, plus other useful micronutrients when reasonably inferable. Omit uncertain nutrient values rather than inventing them.
6. If very few calories remain, provide a hunger-guided light option and state that modestly exceeding the target is preferable to unsafe restriction.
7. Return compact JSON matching the response schema. Put clean plain text inside each field, without code fences or duplicate section headings.

FIELD REQUIREMENTS
- target: Briefly state the remaining calorie and macro targets.
- plan: List only the remaining eating occasions, with portions and nutrition estimates.
- estimatedPlanTotal: Summarize the proposed plan's calories and macros.
- whyThisFits: Explain briefly why the plan fits the user's remaining needs and restrictions.`
}

function buildHealthSummary(dashboard) {
  const summary = dashboard?.today?.summary || {}
  const history = (dashboard?.trends || []).slice(-14)
  return `TODAY'S COMPLETE HEALTH RECORD
${JSON.stringify(summary, null, 2)}

ENERGY AVERAGES
${JSON.stringify(dashboard?.energyAverages || {}, null, 2)}

CURRENT GOALS
${JSON.stringify(Object.fromEntries(Object.entries(dashboard?.goals || {}).map(([key, value]) => [key, value?.target ?? null])), null, 2)}

TODAY'S WORKOUTS
${JSON.stringify(dashboard?.today?.workouts || [], null, 2)}

DAILY HISTORY (last 14 days)
${JSON.stringify(history, null, 2)}`
}

function buildChatContext(state) {
  return `You are Fuel AI, the user's private nutrition, fitness, and recovery assistant. You can read ALL health and nutrition data below, including detailed food nutrients, sodium, caffeine, sugars, energy, activity, sleep, vitals, workouts, swimming, cycling, stride length, cardio recovery, and trends. Never say a listed metric is unavailable.

${buildHealthSummary(state.dashboard)}

REMAINING TODAY
${numberLabel(state.budget.caloriesRemaining)} kcal remaining from a calculated ${numberLabel(state.budget.caloriesGoal)} kcal target (${numberLabel(state.budget.calorieBalancePercent)}% relative to an average burn of ${numberLabel(state.budget.averageExpenditure)} kcal), ${numberLabel(state.budget.proteinRemaining)} g protein, ${numberLabel(state.budget.carbsRemaining)} g carbs, ${numberLabel(state.budget.fatRemaining)} g fat, ${numberLabel(state.budget.fiberRemaining)} g fiber.

FOOD LOGGING AND AUTOMATIC PLANNING
- Populate foods only when the user asks to log food or sends a food photo.
- Estimate a typical serving when details are vague.
- For every logged food, estimate sodium, caffeine, total sugar, added sugar, fat composition, cholesterol, minerals, vitamins, omega fats, water, and alcohol when reasonably inferable. Leave unknown nutrients absent rather than guessing.
- Briefly mention sodium, caffeine, and sugars in the confirmation when they are available.
- After food is logged, Fuel automatically generates a fresh plan for the rest of the day. Keep the confirmation concise because the updated plan will be shown separately.

REGENERATING THE PLAN
- Set regeneratePlan to true when the user asks for a new, fresh, different, or updated meal plan (for example "make me a new plan", "regenerate", "give me a different plan", "redo my plan"). Fuel then generates and shows the new plan separately, so keep reply to a short confirmation.
- Leave regeneratePlan false for ordinary questions and small tweaks that do not warrant a whole new plan.

CONTEXT AND GOALS
- You may read the saved context below.
- When explicitly asked to remember or change a durable preference, return contextUpdate with append or replace.
- When explicitly asked to change goals, return goalUpdates. calorieBalancePercent is negative for deficit, positive for surplus, and zero for maintenance. Never set a fixed calorie number.

RESPONSE FORMAT
Return valid compact JSON matching the schema. The reply field must contain clean, complete plain text. Never place JSON, braces, or a code fence inside reply.

SAVED USER CONTEXT
${limitedText(state.context, 10000) || 'No saved context.'}`
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

// Chat history is simply the most recent MAX_MESSAGES messages. It is never expired
// by time, and never cleared when a new plan is generated — only the explicit
// "Clear chat" action empties it.
function keepRecentMessages(value) {
  return normalizeMessages(value).slice(-MAX_MESSAGES)
}

function normalizeMessages(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => ({
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    text: limitedText(item?.text, 12000),
    at: item?.at || null,
  })).filter((item) => item.text)
}

function normalizeSources(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => ({ title: limitedText(item?.title, 300), url: limitedText(item?.url, 1500), placeId: limitedText(item?.placeId, 300) || null })).filter((item) => item.url)
}

function validatedImage(value) {
  if (!value || typeof value !== 'object') return null
  const mimeType = limitedText(value.mimeType, 60).toLowerCase()
  const data = typeof value.data === 'string' ? value.data.replace(/^data:[^;]+;base64,/, '').trim() : ''
  if (!data) return null
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
    throw geminiError('That image type is not supported. Use a JPEG, PNG, or WebP photo.', 415, 'image_unsupported')
  }
  // base64 inflates by ~4/3, so decode the approximate byte count before accepting.
  if (data.length * 0.75 > MAX_IMAGE_BYTES) {
    throw geminiError('That photo is too large. Please send one under 4 MB.', 413, 'image_too_large')
  }
  return { mimeType, data }
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
