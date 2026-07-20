import { callGemini } from './meal-plan.js'
import { NUTRIENT_JSON_SCHEMA_PROPERTIES, normalizeNutrients } from './nutrients.js'

// Estimates a per-serving nutrition breakdown for a saved recipe from its name,
// serving description and ingredient list. Recipes contributed without nutrition
// would otherwise log as a zero-calorie food entry, which silently corrupts the
// day's energy balance — worse than refusing to log at all.

const MODEL = process.env.GEMINI_RECIPE_MODEL || process.env.GEMINI_MODEL || 'gemini-flash-latest'
const TIMEOUT_MS = 20000

const RESPONSE_SCHEMA = {
  type: 'object',
  required: ['calories', 'protein', 'carbs', 'fat', 'fiber'],
  properties: {
    calories: { type: 'number', description: 'Calories per serving in kcal' },
    protein: { type: 'number', description: 'Protein per serving in grams' },
    carbs: { type: 'number', description: 'Carbohydrates per serving in grams' },
    fat: { type: 'number', description: 'Fat per serving in grams' },
    fiber: { type: 'number', description: 'Fiber per serving in grams' },
    nutrients: { type: 'object', properties: NUTRIENT_JSON_SCHEMA_PROPERTIES },
    assumptions: { type: 'string', description: 'Any quantity assumed because the recipe did not state it.' },
  },
}

// Thrown when Gemini refuses on quota/rate limits. The caller stops the batch on
// this rather than burning the remaining recipes on calls that will also fail.
export class NutritionQuotaError extends Error {
  constructor(message) { super(message); this.name = 'NutritionQuotaError'; this.quotaExhausted = true }
}

export async function estimateRecipeNutrition(recipe) {
  const ingredients = (recipe?.ingredients || []).filter(Boolean)
  if (!ingredients.length) throw new Error('Recipe has no ingredients to estimate from.')

  const prompt = [
    'You are a nutrition database. Estimate the nutrition of ONE SERVING of this recipe.',
    '',
    `Recipe: ${recipe.name}`,
    `One serving is: ${recipe.serving || 'not stated — assume the recipe makes a single serving'}`,
    '',
    'Ingredients:',
    ...ingredients.map((item) => `- ${item}`),
    '',
    'Rules:',
    '- Return values for ONE serving, not the whole recipe. If the ingredient list makes',
    '  multiple servings and the serving size says so, divide accordingly.',
    '- Use standard reference values for each ingredient (USDA-style).',
    '- Where an ingredient has no stated quantity, assume a typical culinary amount and',
    '  say so in "assumptions".',
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
        maxOutputTokens: 1200,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        // gemini-flash-latest is a thinking model and thinking tokens are drawn from
        // maxOutputTokens; leaving this unset truncates the JSON before it closes.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }, false, TIMEOUT_MS)
  } catch (error) {
    // callGemini flattens provider errors into a generic message, which hides the
    // difference between "this recipe failed" and "the API key is out of quota".
    const status = error?.status || error?.statusCode
    if (status === 429 || /quota|rate limit|high demand|RESOURCE_EXHAUSTED/i.test(String(error?.message || ''))) {
      throw new NutritionQuotaError('The Gemini API key is out of quota, so nutrition could not be estimated. Check the key\u2019s billing or try again later.')
    }
    throw error
  }

  const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text).join('') || ''
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Fuel AI returned an unreadable nutrition estimate.')
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
    assumptions: typeof parsed.assumptions === 'string' ? parsed.assumptions.slice(0, 500) : '',
  }
  if (result.calories == null) throw new Error('Fuel AI could not estimate calories for this recipe.')
  // A macro breakdown that contradicts the calorie figure means the model produced
  // an internally inconsistent answer; logging it would quietly skew the day's math.
  const implied = (result.protein || 0) * 4 + (result.carbs || 0) * 4 + (result.fat || 0) * 9
  if (implied > 0 && (result.calories > implied * 1.6 || result.calories < implied * 0.55)) {
    throw new Error('Fuel AI returned an inconsistent nutrition estimate.')
  }
  return result
}
