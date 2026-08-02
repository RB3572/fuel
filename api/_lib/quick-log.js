import { sql } from './db.js'
import { callGemini, DEFAULT_MODEL } from './meal-plan.js'
import { NUTRIENT_JSON_SCHEMA_PROPERTIES, normalizeNutrients, nutrientColumns } from './nutrients.js'

// One photo in, food entries out. This is the whole of /quicklog: no conversation, no
// plan cache, no follow-up — the point is that logging a meal costs one tap, so
// anything that could ask the user a question is deliberately absent.

const MODEL = process.env.GEMINI_QUICKLOG_MODEL || process.env.GEMINI_FOOD_MODEL || process.env.GEMINI_MODEL || DEFAULT_MODEL
const TIMEOUT_MS = 25000
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
// A plate is a handful of items, not a hundred. Bounds the write and the output budget.
const MAX_FOODS = 8

const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['foods'],
  properties: {
    foods: {
      type: 'array',
      items: {
        type: 'object',
        required: ['description', 'calories'],
        properties: {
          description: { type: 'string', description: 'What the item is, e.g. "Grilled chicken burrito"' },
          meal: { type: 'string', description: 'Breakfast, Lunch, Dinner, Snack or Dessert' },
          portion: { type: 'string', description: 'The visible portion, e.g. "1 bowl (approx 350 g)"' },
          calories: { type: 'number' }, protein: { type: 'number' }, carbs: { type: 'number' },
          fat: { type: 'number' }, fiber: { type: 'number' },
          nutrients: { type: 'object', properties: NUTRIENT_JSON_SCHEMA_PROPERTIES },
        },
      },
    },
    note: { type: 'string', description: 'One short sentence about what was recognised.' },
  },
}

export function validatedPhoto(value) {
  if (!value || typeof value !== 'object') throw new Error('A photo is required.')
  const mimeType = String(value.mimeType || '').trim().toLowerCase()
  const data = typeof value.data === 'string' ? value.data.replace(/^data:[^;]+;base64,/, '').trim() : ''
  if (!data) throw new Error('A photo is required.')
  if (!ALLOWED_IMAGE_TYPES.has(mimeType)) throw new Error('That image type is not supported. Use a JPEG, PNG, or WebP photo.')
  // base64 inflates by ~4/3, so check the decoded size.
  if (data.length * 0.75 > MAX_IMAGE_BYTES) throw new Error('That photo is too large. Take another under 6 MB.')
  return { mimeType, data }
}

export async function logPhoto(userId, photo, { mealHint = '', localTime = '' } = {}) {
  const image = validatedPhoto(photo)
  const prompt = [
    'Identify every food and drink in this photo and estimate its nutrition.',
    '',
    mealHint ? `The user says this is: ${mealHint}` : '',
    localTime ? `Local time: ${localTime}. Use it to pick a sensible meal category.` : '',
    '',
    'Rules:',
    '- One entry per distinct item. Combine obvious components of one dish into that dish.',
    '- Estimate for the portion actually visible, not a standard serving.',
    '- Calories must be consistent with the macros (roughly protein*4 + carbs*4 + fat*9).',
    '- Fill in the micronutrients you can reasonably infer; omit ones you cannot.',
    '- If the photo contains no food at all, return an empty foods array.',
  ].filter(Boolean).join('\n')

  const payload = await callGemini(MODEL, {
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: image.mimeType, data: image.data } }, { text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
    },
  }, false, TIMEOUT_MS)

  const candidate = payload?.candidates?.[0]
  const text = candidate?.content?.parts?.map((part) => part.text).join('') || ''
  if (!text) {
    const reason = String(candidate?.finishReason || payload?.promptFeedback?.blockReason || 'no reason given')
    throw new Error(`Fuel AI could not read that photo (${reason}).`)
  }
  let parsed
  try { parsed = JSON.parse(text) } catch { throw new Error('Fuel AI returned an unreadable answer for that photo.') }

  const foods = (Array.isArray(parsed?.foods) ? parsed.foods : []).slice(0, MAX_FOODS)
    .map(normalizeFood)
    .filter((food) => food.description)
  if (!foods.length) return { ok: true, logged: [], note: String(parsed?.note || 'No food was recognised in that photo.') }

  const db = sql()
  const occurredAt = new Date().toISOString()
  const logged = []
  for (const food of foods) {
    const nutrients = normalizeNutrients(food.nutrients)
    const columns = nutrientColumns(nutrients)
    const rows = await db`
      INSERT INTO food_entries (
        user_id, occurred_at, meal, description, portion,
        calories_kcal, protein_g, carbs_g, fat_g, fiber_g,
        sugars_g, added_sugars_g, sodium_mg, caffeine_mg, nutrients,
        confidence, notes, source, ai_filled_at, updated_at
      ) VALUES (
        ${userId}, ${occurredAt}, ${food.meal}, ${food.description}, ${food.portion},
        ${food.calories}, ${food.protein}, ${food.carbs}, ${food.fat}, ${food.fiber},
        ${columns.sugarsG}, ${columns.addedSugarsG}, ${columns.sodiumMg}, ${columns.caffeineMg},
        ${JSON.stringify(nutrients)}::jsonb,
        'estimated', 'Logged from a photo in Fuel quick log.', 'Fuel quick log', now(), now()
      )
      RETURNING id, occurred_at, meal, description, portion, calories_kcal, protein_g, carbs_g, fat_g, fiber_g
    `
    if (rows.length) logged.push(rows[0])
  }
  return { ok: true, logged, note: String(parsed?.note || '') }
}

function normalizeFood(food) {
  const number = (value) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 10) / 10 : null
  }
  const text = (value, max) => {
    const clean = String(value ?? '').trim()
    return clean ? clean.slice(0, max) : null
  }
  return {
    description: text(food?.description, 300),
    meal: text(food?.meal, 100),
    portion: text(food?.portion, 200),
    calories: number(food?.calories),
    protein: number(food?.protein),
    carbs: number(food?.carbs),
    fat: number(food?.fat),
    fiber: number(food?.fiber),
    nutrients: food?.nutrients,
  }
}
