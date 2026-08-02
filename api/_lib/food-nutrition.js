import { callGemini, DEFAULT_MODEL } from './meal-plan.js'
import { asNutritionQuotaError, NutritionQuotaError } from './recipe-nutrition.js'
import { NUTRIENT_JSON_SCHEMA_PROPERTIES, normalizeNutrients } from './nutrients.js'

// Estimates the full nutrition breakdown for a single logged food entry from its
// description, portion and any values already recorded. Used by the dashboard's
// "Fill missing nutrients with AI" action, which back-fills the micronutrients (and
// any absent macros) for today's diary without touching values the user already has.

const MODEL = process.env.GEMINI_FOOD_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL
const TIMEOUT_MS = 20000

const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['calories', 'protein', 'carbs', 'fat', 'fiber'],
  properties: {
    calories: { type: 'number', description: 'Calories for this portion in kcal' },
    protein: { type: 'number', description: 'Protein for this portion in grams' },
    carbs: { type: 'number', description: 'Carbohydrates for this portion in grams' },
    fat: { type: 'number', description: 'Fat for this portion in grams' },
    fiber: { type: 'number', description: 'Fiber for this portion in grams' },
    nutrients: { type: 'object', properties: NUTRIENT_JSON_SCHEMA_PROPERTIES },
  },
}

export { NutritionQuotaError }

export async function estimateFoodNutrition(entry) {
  const description = String(entry?.description || '').trim()
  if (!description) throw new Error('This entry has no description to estimate from.')

  const known = []
  if (entry?.calories != null) known.push(`calories: ${entry.calories} kcal`)
  if (entry?.protein != null) known.push(`protein: ${entry.protein} g`)
  if (entry?.carbs != null) known.push(`carbs: ${entry.carbs} g`)
  if (entry?.fat != null) known.push(`fat: ${entry.fat} g`)
  if (entry?.fiber != null) known.push(`fiber: ${entry.fiber} g`)

  const prompt = [
    'You are a nutrition database. Estimate the nutrition of this exact logged food.',
    '',
    `Food: ${description}`,
    `Portion: ${entry?.portion || 'one typical serving'}`,
    known.length ? `Already recorded (keep consistent with these): ${known.join(', ')}` : '',
    '',
    'Rules:',
    '- Estimate for THIS portion, not per 100 g.',
    '- Use standard reference values (USDA-style).',
    '- Stay consistent with any already-recorded values above.',
    '- Fill in every micronutrient you can reasonably infer; omit ones you cannot.',
    '- Numbers only, no ranges. Calories must be consistent with the macros',
    '  (roughly protein*4 + carbs*4 + fat*9).',
  ].filter(Boolean).join('\n')

  let payload
  try {
    payload = await callGemini(MODEL, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
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

  // Report the actual failure. A truncated answer, a blocked answer and malformed JSON
  // are three different problems with three different fixes, and collapsing them into
  // "unreadable" is how this stayed undiagnosed.
  const candidate = payload?.candidates?.[0]
  const text = candidate?.content?.parts?.map((part) => part.text).join('') || ''
  if (!text) {
    const reason = String(candidate?.finishReason || payload?.promptFeedback?.blockReason || 'no reason given')
    if (/MAX_TOKENS/i.test(reason)) throw new Error('Fuel AI ran out of output space before finishing the estimate.')
    if (/SAFETY|BLOCK|RECITATION/i.test(reason)) throw new Error(`Fuel AI declined to estimate this entry (${reason}).`)
    throw new Error(`Fuel AI returned an empty nutrition estimate (${reason}).`)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`Fuel AI returned unreadable JSON: ${text.slice(0, 120)}`)
  }

  const macro = (value) => {
    const parsedValue = Number(value)
    return Number.isFinite(parsedValue) && parsedValue >= 0 ? Math.round(parsedValue * 10) / 10 : null
  }
  const result = {
    calories: macro(parsed.calories),
    protein: macro(parsed.protein),
    carbs: macro(parsed.carbs),
    fat: macro(parsed.fat),
    fiber: macro(parsed.fiber),
    nutrients: normalizeNutrients(parsed.nutrients),
  }
  // A macro breakdown that contradicts its own calorie figure is internally
  // inconsistent; reject it rather than writing nonsense into the diary.
  const implied = (result.protein || 0) * 4 + (result.carbs || 0) * 4 + (result.fat || 0) * 9
  if (result.calories != null && implied > 0 && (result.calories > implied * 1.7 || result.calories < implied * 0.5)) {
    throw new Error('Fuel AI returned an inconsistent nutrition estimate.')
  }
  return result
}
