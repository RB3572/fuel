import { callGemini, DEFAULT_MODEL } from './meal-plan.js'
import { asNutritionQuotaError, NutritionQuotaError } from './recipe-nutrition.js'
import { NUTRIENT_JSON_SCHEMA_PROPERTIES, normalizeNutrients } from './nutrients.js'

// Estimates nutrition for logged food entries, for the dashboard's "Fill missing
// nutrients with AI" action. It back-fills micronutrients (and any absent macros)
// without touching values the user already has.
//
// The whole diary goes up in ONE request. This used to be a request per entry, which
// on the free tier — roughly ten requests a minute — meant a diary of six meals could
// exhaust the allowance before it finished, and the batch then died half-done. One
// call for the batch turns a rate-limit problem into a non-problem: a day's food is a
// single request, and the model gets the whole day as context while it estimates.

const MODEL = process.env.GEMINI_FOOD_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL
const TIMEOUT_MS = 45000
// Bounded so one response cannot outgrow the output budget: each item can carry ~40
// nutrient fields, so a dozen is already a large answer.
export const MAX_BATCH = 12

const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      description: 'One entry per numbered food, in any order.',
      items: {
        type: 'object',
        required: ['number', 'calories', 'protein', 'carbs', 'fat', 'fiber'],
        properties: {
          number: { type: 'integer', description: 'The number of the food this estimate is for.' },
          calories: { type: 'number', description: 'Calories for this portion in kcal' },
          protein: { type: 'number', description: 'Protein for this portion in grams' },
          carbs: { type: 'number', description: 'Carbohydrates for this portion in grams' },
          fat: { type: 'number', description: 'Fat for this portion in grams' },
          fiber: { type: 'number', description: 'Fiber for this portion in grams' },
          nutrients: { type: 'object', properties: NUTRIENT_JSON_SCHEMA_PROPERTIES },
        },
      },
    },
  },
}

export { NutritionQuotaError }

// Returns a Map of index -> estimate for the entries it could handle. An entry the
// model skipped or answered inconsistently is simply absent, so the caller reports
// exactly which ones failed instead of losing the whole batch to one bad item.
export async function estimateFoodNutritionBatch(entries) {
  const batch = (entries || []).slice(0, MAX_BATCH)
  if (!batch.length) return new Map()

  const lines = batch.map((entry, index) => {
    const known = []
    if (entry?.calories != null) known.push(`calories ${entry.calories} kcal`)
    if (entry?.protein != null) known.push(`protein ${entry.protein} g`)
    if (entry?.carbs != null) known.push(`carbs ${entry.carbs} g`)
    if (entry?.fat != null) known.push(`fat ${entry.fat} g`)
    if (entry?.fiber != null) known.push(`fiber ${entry.fiber} g`)
    return [
      `${index + 1}. ${String(entry?.description || '').trim()}`,
      `   Portion: ${entry?.portion || 'one typical serving'}`,
      known.length ? `   Already recorded (keep consistent with these): ${known.join(', ')}` : '',
    ].filter(Boolean).join('\n')
  }).join('\n')

  const prompt = [
    'You are a nutrition database. Estimate the nutrition of each of these logged foods.',
    '',
    lines,
    '',
    'Rules:',
    '- Return one item per numbered food, echoing its number. Do not skip any.',
    '- Estimate for THAT portion, not per 100 g.',
    '- Use standard reference values (USDA-style).',
    '- Stay consistent with any already-recorded values.',
    '- Fill in every micronutrient you can reasonably infer; omit ones you cannot.',
    '- Numbers only, no ranges. Calories must be consistent with the macros',
    '  (roughly protein*4 + carbs*4 + fat*9).',
  ].join('\n')

  let payload
  try {
    payload = await callGemini(MODEL, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        // Scaled to the batch: ~40 nutrient fields per item adds up quickly, and a
        // truncated answer costs the whole request.
        maxOutputTokens: Math.min(32000, 1200 + batch.length * 900),
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        // The Flash models are thinking models and thinking tokens are drawn from
        // maxOutputTokens; leaving this unset truncates the JSON before it closes.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }, false, TIMEOUT_MS)
  } catch (error) {
    // Separate a transient rate limit from a key that cannot call Gemini at all, and
    // keep Gemini's own wording either way — the batch caller decides what to do.
    const quota = asNutritionQuotaError(error)
    if (quota) throw quota
    throw error
  }

  const candidate = payload?.candidates?.[0]
  const text = candidate?.content?.parts?.map((part) => part.text).join('') || ''
  if (!text) {
    const reason = String(candidate?.finishReason || payload?.promptFeedback?.blockReason || 'no reason given')
    if (/MAX_TOKENS/i.test(reason)) throw new Error('Fuel AI ran out of output space before finishing the estimates.')
    if (/SAFETY|BLOCK|RECITATION/i.test(reason)) throw new Error(`Fuel AI declined to estimate these entries (${reason}).`)
    throw new Error(`Fuel AI returned an empty nutrition estimate (${reason}).`)
  }
  let parsed
  try { parsed = JSON.parse(text) } catch { throw new Error(`Fuel AI returned unreadable JSON: ${text.slice(0, 120)}`) }

  const estimates = new Map()
  for (const item of Array.isArray(parsed?.items) ? parsed.items : []) {
    const number = Number(item?.number)
    const index = Number.isInteger(number) ? number - 1 : -1
    if (index < 0 || index >= batch.length || estimates.has(index)) continue
    const estimate = normalizeEstimate(item)
    if (estimate) estimates.set(index, estimate)
  }
  return estimates
}

function normalizeEstimate(item) {
  const macro = (value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 10) / 10 : null
  }
  const estimate = {
    calories: macro(item?.calories),
    protein: macro(item?.protein),
    carbs: macro(item?.carbs),
    fat: macro(item?.fat),
    fiber: macro(item?.fiber),
    nutrients: normalizeNutrients(item?.nutrients),
  }
  // A macro breakdown that contradicts its own calorie figure is internally
  // inconsistent; drop that item rather than writing nonsense into the diary. One bad
  // item no longer costs the rest of the batch, since they travelled together.
  const implied = (estimate.protein || 0) * 4 + (estimate.carbs || 0) * 4 + (estimate.fat || 0) * 9
  if (estimate.calories != null && implied > 0 && (estimate.calories > implied * 1.7 || estimate.calories < implied * 0.5)) return null
  return estimate
}
