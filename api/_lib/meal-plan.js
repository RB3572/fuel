import { ensureUserFromSession, sql } from './db.js'
import { appUrl, authenticatedSession } from './google.js'
import { methodNotAllowed, sendJson } from './http.js'
import { getNeonDashboard } from './neon-dashboard.js'
import { appendUserContext, getUserContext } from './user-context.js'
import { saveUserGoals } from './goals.js'
import { ensureNutrientSchema, NUTRIENT_JSON_SCHEMA_PROPERTIES, normalizeNutrients, nutrientColumns, nutrientSummaryText } from './nutrients.js'

const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models'
// Models to try, in order: all multimodal (needed for photo logging) and all carrying
// a free tier.
//
// Google retires these faster than anything else in the stack. gemini-2.0-flash and
// -flash-lite are shut down outright, and 2.5-flash-lite is closed to keys created
// after its retirement — which silently invalidated an entire fallback chain built out
// of 2.x. The list is 3.x-first for that reason, with 2.5-flash kept only as a last
// resort for older keys that still have it.
//
// Before that it was the rolling `gemini-flash-latest` alias, which Google points at
// its newest Flash model — and free-tier keys are allocated a quota of ZERO there, so
// every call 429'd on the first request of the day.
//
// Override the whole order with GEMINI_MODEL.
export const GEMINI_MODEL_FALLBACKS = ['gemini-3.1-flash-lite', 'gemini-3.5-flash-lite', 'gemini-3.6-flash', 'gemini-2.5-flash']
export const DEFAULT_MODEL = GEMINI_MODEL_FALLBACKS[0]
// Free-tier keys are rate-limited per minute, so a burst legitimately gets a retryable
// 429. Wait and retry when Google says the wait is short; anything longer is not worth
// holding a request open for, so it falls through to the next model instead.
const GEMINI_MAX_RETRIES = 1
const GEMINI_MAX_RETRY_DELAY_MS = 6000
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
      const answer = await answerChat({ state, cache, message, image })
      if (answer.foods.length) await logFoods(userId, answer.foods)
      let contextResult = null
      // Append only. Fuel AI can add a newly learned preference but can never edit or
      // remove one: a model rewriting the whole context silently drops facts the user
      // mentioned once and never sees again. Editing stays with the user, in the
      // Preferences & context screen.
      if (answer.contextUpdate) contextResult = await appendUserContext(userId, answer.contextUpdate.context)
      let goalsResult = null
      if (Object.keys(answer.goalUpdates).length) goalsResult = await saveUserGoals(userId, { goals: answer.goalUpdates })
      // Refresh budget/food-count in the response when chat changed the diary or goals.
      // The plan itself is never touched here — it is only ever (re)built by the
      // explicit "New plan" action, so chat can log food and answer questions against
      // the existing plan without regenerating it.
      const dataChanged = Boolean(answer.foods.length || contextResult || goalsResult)
      const nextState = dataChanged ? await currentState(userId) : state
      const additions = [
        { role: 'user', text: message || 'Sent a photo to log.', at: new Date().toISOString() },
        { role: 'assistant', text: answer.text, at: new Date().toISOString() },
      ]
      const messages = appendMessages(cache?.messages, additions)
      const saved = await saveCachedPlan(userId, {
        foodFingerprint: cache?.food_fingerprint || state.foodFingerprint,
        plan: cache?.plan || '',
        messages,
        sources: cache?.sources,
        model: answer.model,
        generatedAt: cache?.generated_at || new Date(),
      })
      sendJson(res, 200, {
        ...responseBase(nextState, saved),
        reply: answer.text,
        loggedFoods: answer.foods,
        contextUpdated: Boolean(contextResult),
        goalsUpdated: Boolean(goalsResult),
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
          // Reset the thread to the current plan so the chat restarts from it.
          messages: cache.plan ? [{ role: 'assistant', text: cache.plan, at: new Date().toISOString(), kind: 'plan' }] : [],
          sources: cache.sources,
          model: cache.model,
          generatedAt: cache.generated_at || new Date(),
        })
      }
      const clearedMessages = cache?.plan ? keepRecentMessages([{ role: 'assistant', text: cache.plan, at: new Date().toISOString(), kind: 'plan' }]) : []
      sendJson(res, 200, { ...responseBase(state, validCache ? cache : null), messages: clearedMessages, cleared: true }, cookie ? [cookie] : [])
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
    // A newly generated plan keeps the rest of the conversation and is appended as the
    // newest message, but only one plan is ever kept in the thread — any earlier plan
    // messages are dropped so the new one replaces them rather than piling up.
    const withoutOldPlans = normalizeMessages(cache?.messages).filter((item) => item.kind !== 'plan')
    const saved = await saveCachedPlan(userId, {
      foodFingerprint: state.foodFingerprint,
      plan: generated.text,
      messages: appendMessages(withoutOldPlans, [{ role: 'assistant', text: generated.text, at: new Date().toISOString(), kind: 'plan' }]),
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
      // The Flash models are thinking models whose reasoning tokens count against
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
    const raw = responseText(payload)
    console.error('Fuel AI plan: unparseable response after retry', { finishReason: parsed.candidate?.finishReason, rawLength: raw.length, rawPreview: raw.slice(0, 300) })
    throw geminiError(`Fuel AI could not produce a complete meal plan (${incompleteReasonLabel(parsed.candidate, raw)}). Please try again.`, 502, 'gemini_incomplete_plan')
  }
  const text = formatPlanPayload(parsed)
  return { text, sources: [], model }
}

// Turns a failed candidate into a specific, useful reason instead of a bare "it
// didn't work" — cut off vs blocked vs genuinely unreadable are different problems
// with different fixes, and a user (or a screenshot of one) can tell them apart.
function incompleteReasonLabel(candidate, raw) {
  const reason = candidate?.finishReason
  if (reason === 'MAX_TOKENS') return 'the answer ran out of room before it finished'
  if (reason === 'SAFETY' || reason === 'RECITATION' || reason === 'BLOCKLIST' || reason === 'PROHIBITED_CONTENT') return 'the response was blocked by a safety filter'
  if (!raw) return 'no response text came back'
  return 'the response could not be read as valid data'
}

function parsePlanPayload(payload) {
  const candidate = payload?.candidates?.[0]
  // Must exclude thought:true reasoning parts (see responseText's own comment) — a
  // thinking model's reasoning concatenated in front of the JSON is what produced
  // "Fuel AI could not produce a complete meal plan" on an otherwise-fine answer.
  const raw = responseText(payload)
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
    // Append-only: there is deliberately no mode here. See the write in handleMealPlan.
    contextUpdate: {
      type: 'object',
      properties: { context: { type: 'string' } },
      required: ['context'],
    },
    goalUpdates: {
      type: 'object',
      properties: {
        calorieBalancePercent: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' }, fat: { type: 'number' }, fiber: { type: 'number' },
        move: { type: 'number' }, exercise: { type: 'number' }, stand: { type: 'number' }, steps: { type: 'number' }, sleepHours: { type: 'number' },
      },
    },
  },
  required: ['reply'],
}

async function answerChat({ state, cache, message, image }) {
  const model = process.env.GEMINI_MEAL_PLAN_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL
  const prior = normalizeMessages(cache?.messages).slice(-MAX_MESSAGES)
  const parts = []
  if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } })
  parts.push({ text: message || 'Log the food in this photo.' })
  const contents = [
    { role: 'user', parts: [{ text: buildChatContext(state) }] },
    ...(cache?.plan ? [{ role: 'model', parts: [{ text: cache.plan }] }] : []),
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
  // Must exclude thought:true reasoning parts, same as parsePlanPayload and quick-log's
  // parseJsonResponse — a thinking model's reasoning concatenated in front of the JSON
  // produces a string that cannot be parsed, which read to the user as a generic
  // "invalid"/incomplete response even though the model actually answered fine.
  let raw = responseText(payload)
  let parsed = parseStructuredChatResponse(raw)
  if (!parsed.valid || candidate?.finishReason === 'MAX_TOKENS') {
    payload = await callGemini(model, {
      ...request,
      contents: [...contents, { role: 'model', parts: [{ text: raw || '{}' }] }, { role: 'user', parts: [{ text: 'The prior response was invalid or truncated. Return complete, compact JSON matching the schema. Keep reply under 900 words. Never wrap JSON in a code fence.' }] }],
      generationConfig: { ...request.generationConfig, maxOutputTokens: 2400 },
    }, false, GEMINI_RETRY_TIMEOUT_MS)
    candidate = payload?.candidates?.[0]
    raw = responseText(payload)
    parsed = parseStructuredChatResponse(raw)
  }
  if (!parsed.valid) {
    console.error('Fuel AI chat: unparseable response after retry', { finishReason: candidate?.finishReason, rawLength: raw.length, rawPreview: raw.slice(0, 300) })
    throw geminiError(`Fuel AI could not produce a complete response (${incompleteReasonLabel(candidate, raw)}). Please try that message again.`, 502, 'gemini_incomplete_response')
  }
  const text = limitedText(cleanReplyText(parsed.reply), 12000)
  if (!text) throw geminiError('Gemini returned an empty response.', 502, 'gemini_empty_response')
  return {
    text,
    foods: normalizeFoods(parsed.foods),
    contextUpdate: normalizeContextUpdate(parsed.contextUpdate),
    goalUpdates: normalizeGoalUpdates(parsed.goalUpdates),
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
      return { valid: typeof parsed.reply === 'string', reply: parsed.reply || '', foods: parsed.foods || [], contextUpdate: parsed.contextUpdate || null, goalUpdates: parsed.goalUpdates || {} }
    }
  } catch { /* extract a safe reply below */ }
  return { valid: false, reply: extractJsonStringField(raw, 'reply') || raw.replace(/^\s*[\[{]+/, '').replace(/[\]}]+\s*$/, ''), foods: [], contextUpdate: null, goalUpdates: {} }
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
  // No mode: any 'replace' a model invents is dropped here rather than honoured.
  return context ? { context } : null
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

  // The requested model first, then the fallbacks, deduped.
  const candidates = []
  for (const name of [model, ...GEMINI_MODEL_FALLBACKS]) {
    const trimmed = String(name || '').trim()
    if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed)
  }

  let lastError = null
  const unavailable = []
  for (const candidate of candidates) {
    try {
      return await callGeminiModel(candidate, requestBody, { headers, timeoutMs, allowMapsFallback })
    } catch (error) {
      if (!error?.tryNextModel) throw error
      lastError = error
      unavailable.push(`${candidate}: ${error.providerReason || error.code}`)
      console.warn(`Gemini model ${candidate} is unavailable for this key; trying the next one.`, error.providerReason || '')
    }
  }
  // Every candidate refused. If they all refused for lack of quota, the key's project
  // has no allocation at all rather than one model being unlucky — say so, because the
  // fix is a new key, not waiting or paying.
  if (lastError?.code === 'gemini_no_quota') {
    const exhausted = geminiError(
      'Gemini reports no free-tier quota for this API key on any Fuel model. That usually means the key’s Google Cloud project has no Generative Language allocation — creating a fresh key in Google AI Studio normally fixes it.',
      429, 'gemini_no_quota',
    )
    exhausted.providerReason = lastError.providerReason
    throw exhausted
  }
  console.error('Every Gemini model failed', unavailable.join(' | '))
  throw lastError || geminiError('Fuel AI is temporarily unavailable. Please try again.', 502, 'gemini_request_failed')
}

// Reasoning tokens are drawn from maxOutputTokens, so every caller asks for the least
// thinking it can — otherwise a long deliberation truncates the JSON before it closes.
// How you ask differs by family, and asking the wrong way is a 400 on the whole
// request:
//   2.5.x  generationConfig.thinkingConfig.thinkingBudget
//   3.x    generationConfig.thinkingLevel ('minimal' is the floor; there is no zero)
//   older  neither — the field is unknown and rejected
// stripThinking() is the escape hatch: if Google renames any of this again, the caller
// retries once without it rather than failing every request until someone notices.
const THINKING_BUDGET_FAMILY = /gemini-2\.5/
const THINKING_LEVEL_FAMILY = /gemini-(3|[4-9])/
function bodyForModel(model, requestBody) {
  const generationConfig = requestBody?.generationConfig
  if (!generationConfig?.thinkingConfig) return requestBody
  if (THINKING_BUDGET_FAMILY.test(model)) return requestBody
  const { thinkingConfig: _dropped, ...rest } = generationConfig
  if (THINKING_LEVEL_FAMILY.test(model)) {
    return { ...requestBody, generationConfig: { ...rest, thinkingLevel: 'minimal' } }
  }
  return { ...requestBody, generationConfig: rest }
}
function stripThinking(requestBody) {
  const generationConfig = requestBody?.generationConfig
  if (!generationConfig) return requestBody
  const { thinkingConfig: _a, thinkingLevel: _b, ...rest } = generationConfig
  return { ...requestBody, generationConfig: rest }
}
// A 400 naming one of the thinking fields means this model wants it expressed some
// other way. Dropping it costs a little output budget; guessing again costs everything.
function isThinkingRejection(reason) {
  return /thinking(config|level|budget)/i.test(String(reason || ''))
}

async function callGeminiModel(model, requestBody, { headers, timeoutMs, allowMapsFallback }) {
  requestBody = bodyForModel(model, requestBody)
  let strippedThinking = false
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

  for (let attempt = 0; ; attempt += 1) {
    let result = await invoke(requestBody)
    if (!result.response.ok && allowMapsFallback && requestBody.tools) {
      const fallback = { ...requestBody }
      delete fallback.tools
      delete fallback.toolConfig
      result = await invoke(fallback)
    }
    if (result.response.ok) return result.payload

    const failure = classifyGeminiFailure(model, result)
    // The model rejected how we asked for less thinking, not what we asked it to do.
    if (failure.thinkingRejected && !strippedThinking) {
      strippedThinking = true
      requestBody = stripThinking(requestBody)
      console.warn(`Gemini ${model} rejected the thinking hint; retrying without it.`)
      continue
    }
    if (failure.retryAfterMs != null && attempt < GEMINI_MAX_RETRIES) {
      console.warn(`Gemini rate-limited ${model}; retrying in ${failure.retryAfterMs}ms.`)
      await new Promise((resolve) => setTimeout(resolve, failure.retryAfterMs))
      continue
    }
    throw failure.error
  }
}

// Turns a Gemini error body into a decision: retry this model, move to the next one, or
// give up. The provider's own words are kept on the error so a failure is diagnosable
// instead of guessed at — the previous code logged them and reported "please try again"
// to everything, which is how a zero-quota model passed for an exhausted account.
function classifyGeminiFailure(model, { response, payload }) {
  const providerReason = String(payload?.error?.message || payload?.error || `Gemini returned ${response.status}.`)
  const details = Array.isArray(payload?.error?.details) ? payload.error.details : []
  const status = response.status
  console.error(`Gemini provider error (${model}, ${status})`, providerReason)

  // How we asked for less thinking, rather than what we asked for. Recoverable on this
  // same model by dropping the hint.
  if (status === 400 && isThinkingRejection(providerReason)) {
    return { thinkingRejected: true, error: tagged(geminiError('Fuel AI rejected the request configuration.', 400, 'gemini_schema_rejected'), providerReason) }
  }

  // Our own malformed request: every model would reject it identically.
  if (/Invalid JSON payload|response_schema|Unknown name \\"additionalProperties\\"|Cannot find field/i.test(providerReason)) {
    return { error: geminiError('Fuel AI response formatting was rejected. Please try again.', 502, 'gemini_schema_rejected') }
  }

  if (status === 429) {
    // A quota violation reporting a limit of zero is an allocation problem, not usage:
    // no amount of waiting helps, so move on to the next model immediately.
    const violations = details.flatMap((detail) => (Array.isArray(detail?.violations) ? detail.violations : []))
    const zeroQuota = violations.some((violation) => Number(violation?.quotaValue) === 0) || /limit:\s*0\b/i.test(providerReason)
    if (zeroQuota) {
      return { error: tagged(geminiError(`No free-tier Gemini quota is allocated for ${model}.`, 429, 'gemini_no_quota'), providerReason) }
    }
    const retryAfterMs = retryDelayMs(details)
    if (retryAfterMs != null && retryAfterMs <= GEMINI_MAX_RETRY_DELAY_MS) return { retryAfterMs, error: rateLimited(providerReason) }
    return { error: tagged(rateLimited(providerReason), providerReason) }
  }

  // 404 is a model this key cannot see; 5xx is an overloaded one. Either way, next.
  if (status === 404 || status >= 500) {
    return { error: tagged(geminiError('Fuel AI is temporarily unavailable. Please try again.', 502, 'gemini_request_failed'), providerReason) }
  }

  const code = status === 403 ? 'gemini_permission_denied' : 'gemini_request_failed'
  const publicMessage = status === 400 && /API key not valid|API_KEY_INVALID/i.test(providerReason)
    ? 'The Gemini API key is not valid. Create a new key in Google AI Studio and set GEMINI_API_KEY.'
    : status === 403
      ? 'Gemini refused this key. Check that the Generative Language API is enabled for its project.'
      : 'Fuel AI could not process that request. Please try again.'
  const error = geminiError(publicMessage, status, code)
  error.providerReason = providerReason
  return { error }
}

// Rate limiting is transient by definition, so this stays separate from a zero
// allocation: the user should be told to wait, not to go looking at billing.
function rateLimited(providerReason) {
  const error = geminiError('Fuel AI hit the free Gemini rate limit. Wait a minute and try again.', 429, 'gemini_rate_limited')
  error.providerReason = providerReason
  return error
}
function tagged(error, providerReason) {
  error.tryNextModel = true
  error.providerReason = providerReason
  return error
}
// Google returns RetryInfo as a duration string such as "31s".
function retryDelayMs(details) {
  for (const detail of details) {
    const raw = String(detail?.retryDelay || '')
    const match = raw.match(/^([\d.]+)s$/)
    if (match) return Math.round(Number(match[1]) * 1000)
  }
  return null
}

// Reading a model's answer out of a response is not `parts.map(p => p.text)`.
//
// Thinking models return their reasoning as extra parts in the same array, flagged
// `thought: true`. Concatenating those in front of the JSON produces a string that
// cannot be parsed — which is what "Fuel AI returned an unreadable answer" was. The
// filter is harmless on models that emit no thoughts, and correct on the ones that do.
export function responseText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts
  if (!Array.isArray(parts)) return ''
  return parts.filter((part) => part?.thought !== true).map((part) => part?.text || '').join('').trim()
}

// Even with a responseSchema, an answer can arrive fenced in markdown or with a
// sentence in front of it. Parse what is there rather than insisting it be pristine:
// the alternative is discarding a perfectly good estimate over punctuation.
export function parseJsonResponse(payload) {
  const text = responseText(payload)
  if (!text) return { text: '', value: null }
  const unfenced = stripCodeFence(text)
  try { return { text: unfenced, value: JSON.parse(unfenced) } } catch { /* fall through */ }
  const first = unfenced.indexOf('{')
  const last = unfenced.lastIndexOf('}')
  if (first >= 0 && last > first) {
    try { return { text: unfenced, value: JSON.parse(unfenced.slice(first, last + 1)) } } catch { /* fall through */ }
  }
  return { text: unfenced, value: null }
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

FOOD LOGGING
- Populate foods only when the user asks to log food or sends a food photo.
- Estimate a typical serving when details are vague.
- For every logged food, estimate sodium, caffeine, total sugar, added sugar, fat composition, cholesterol, minerals, vitamins, omega fats, water, and alcohol when reasonably inferable. Leave unknown nutrients absent rather than guessing.
- Briefly mention sodium, caffeine, and sugars in the confirmation when they are available.
- Logging food here does not change the meal plan above. If the user wants an updated plan, tell them to tap "New plan".

CONTEXT AND GOALS
- You may read the saved context below.
- When explicitly asked to remember a durable preference, return contextUpdate with ONLY the new fact. Saved context is append-only: what you send is added to it and nothing can be edited or removed, so never restate or rewrite context that is already there.
- If the user wants saved context changed or deleted, tell them to edit it themselves under Preferences & context. You cannot do it for them.
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
    // Marks a message that IS a generated day plan, so the client renders it with the
    // plan styling. Plans are ordinary messages in the thread, not a pinned header.
    ...(item?.kind === 'plan' ? { kind: 'plan' } : {}),
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
