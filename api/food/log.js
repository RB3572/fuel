import { ensureUserFromSession, sql, userForSyncToken } from '../_lib/db.js'
import { authenticatedSession } from '../_lib/google.js'
import { methodNotAllowed, sendJson } from '../_lib/http.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }

  try {
    const user = await authenticatedUser(req)
    if (!user) {
      sendJson(res, 401, { error: 'Sign in or provide a valid Fuel bearer token.' })
      return
    }

    const body = unwrap(req.body)
    const description = text(body.description ?? body.food ?? body.name)
    if (!description) {
      sendJson(res, 422, { error: 'A food description is required.' })
      return
    }

    const occurredAt = validDate(body.occurredAt ?? body.occurred_at ?? body.date) || new Date()
    const record = {
      meal: text(body.meal),
      description,
      portion: text(body.portion),
      calories: number(body.calories ?? body.caloriesKcal ?? body.calories_kcal),
      protein: number(body.protein ?? body.proteinG ?? body.protein_g),
      carbs: number(body.carbs ?? body.carbsG ?? body.carbs_g),
      fat: number(body.fat ?? body.fatG ?? body.fat_g),
      fiber: number(body.fiber ?? body.fiberG ?? body.fiber_g),
      confidence: text(body.confidence) || 'estimated',
      notes: text(body.notes),
      source: text(body.source) || 'Fuel API',
    }

    const db = sql()
    const rows = await db`
      INSERT INTO food_entries (
        user_id, occurred_at, meal, description, portion,
        calories_kcal, protein_g, carbs_g, fat_g, fiber_g,
        confidence, notes, source, updated_at
      ) VALUES (
        ${user.id}, ${occurredAt.toISOString()}, ${record.meal}, ${record.description}, ${record.portion},
        ${record.calories}, ${record.protein}, ${record.carbs}, ${record.fat}, ${record.fiber},
        ${record.confidence}, ${record.notes}, ${record.source}, now()
      )
      RETURNING id, occurred_at, meal, description, portion,
        calories_kcal, protein_g, carbs_g, fat_g, fiber_g,
        confidence, notes, source
    `

    sendJson(res, 201, { ok: true, entry: rows[0] })
  } catch (error) {
    console.error('Food logging failed', error)
    sendJson(res, 500, { error: 'Food could not be logged.' })
  }
}

async function authenticatedUser(req) {
  const authorization = String(req.headers.authorization || '')
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (token) return userForSyncToken(token).catch(() => null)

  const { session } = await authenticatedSession(req)
  if (!session) return null
  const userId = await ensureUserFromSession(session)
  return { id: userId }
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
