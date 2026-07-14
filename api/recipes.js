import { ensureUserFromSession, sql } from './_lib/db.js'
import { authenticatedSession } from './_lib/google.js'
import { methodNotAllowed, sendJson } from './_lib/http.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  try {
    const { session, cookie } = await authenticatedSession(req)
    if (!session) {
      sendJson(res, 401, { error: 'Not authenticated' })
      return
    }
    const userId = await ensureUserFromSession(session)
    const db = sql()
    const rows = await db`
      SELECT id, name, serving, ingredients, calories_kcal, protein_g, carbs_g,
             fat_g, fiber_g, notes, source, updated_at
      FROM recipes
      WHERE user_id = ${userId}
      ORDER BY name ASC
    `
    sendJson(res, 200, { recipes: rows.map(normalizeRecipe) }, cookie ? [cookie] : [])
  } catch (error) {
    console.error('Unable to load recipes', error)
    sendJson(res, 500, { error: 'Unable to load recipes.' })
  }
}

function normalizeRecipe(row) {
  const name = row.name || 'Untitled recipe'
  const lower = name.toLowerCase()
  const category = lower.includes('creami') || lower.includes('ninja') ? 'Ninja Creami' : lower.includes('oat') ? 'Breakfast and oats' : lower.includes('smoothie') || lower.includes('shake') ? 'Drinks and smoothies' : lower.includes('dessert') || lower.includes('cookie') || lower.includes('ice cream') ? 'Desserts' : 'Other recipes'
  return {
    id: row.id,
    name,
    category,
    serving: row.serving || '',
    ingredients: splitList(row.ingredients),
    instructions: splitInstructions(row.notes),
    nutrition: {
      calories: number(row.calories_kcal),
      protein: number(row.protein_g),
      carbs: number(row.carbs_g),
      fat: number(row.fat_g),
      fiber: number(row.fiber_g),
    },
    source: row.source || '',
    updatedAt: row.updated_at || null,
  }
}

function splitList(value) {
  if (!value) return []
  return String(value).split(/\s*;\s*|\n+/).map(item => item.trim()).filter(Boolean)
}

function splitInstructions(value) {
  if (!value || /^saved recipe\.?$/i.test(String(value).trim())) return []
  return String(value).split(/\n+|(?<=\.)\s+(?=[A-Z0-9])/).map(item => item.trim()).filter(Boolean)
}

function number(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
