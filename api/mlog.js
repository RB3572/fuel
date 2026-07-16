import { ensureUserFromSession, sql, userForSyncToken } from './_lib/db.js'
import { authenticatedSession, appUrl } from './_lib/google.js'
import { methodNotAllowed, sendJson } from './_lib/http.js'
import { handleMcpOAuthRoute } from './_lib/mcp-oauth-routes.js'
import { authorizationServerMetadata } from './_lib/mcp-auth.js'
import { getDynamicClientMetadata, registerDynamicClient } from './_lib/mcp-dcr.js'
import { getNeonDashboard } from './_lib/neon-dashboard.js'
import { getUserContext, saveUserContext } from './_lib/user-context.js'

const TIME_ZONE = 'America/Los_Angeles'

export default async function handler(req, res) {
  const integrationRoute = routeFromRequest(req)
  if (integrationRoute === 'authorization-server') {
    if (req.method !== 'GET') {
      methodNotAllowed(res, ['GET'])
      return
    }
    res.setHeader('Cache-Control', 'public, max-age=300')
    sendJson(res, 200, {
      ...authorizationServerMetadata(),
      registration_endpoint: `${appUrl()}/oauth/register`,
    })
    return
  }
  if (integrationRoute === 'register') {
    if (req.method !== 'POST') {
      methodNotAllowed(res, ['POST'])
      return
    }
    res.setHeader('Cache-Control', 'no-store')
    try {
      const client = await registerDynamicClient(unwrap(req.body))
      sendJson(res, 201, client)
    } catch (error) {
      sendJson(res, error.statusCode || 400, {
        error: error.oauthCode || 'invalid_client_metadata',
        error_description: error.message || 'Unable to register this OAuth client.',
      })
    }
    return
  }
  if (integrationRoute === 'client-metadata') {
    if (req.method !== 'GET') {
      methodNotAllowed(res, ['GET'])
      return
    }
    const requestUrl = new URL(req.url, appUrl())
    requestUrl.searchParams.delete('fuel_route')
    const clientId = `${appUrl()}/oauth/client-metadata?id=${encodeURIComponent(requestUrl.searchParams.get('id') || '')}`
    const metadata = await getDynamicClientMetadata(clientId)
    if (!metadata) {
      sendJson(res, 404, { error: 'OAuth client not found.' })
      return
    }
    res.setHeader('Cache-Control', 'public, max-age=300')
    sendJson(res, 200, metadata)
    return
  }
  if (integrationRoute === 'user-context') {
    await handleUserContext(req, res)
    return
  }
  if (integrationRoute) {
    await handleMcpOAuthRoute(integrationRoute, req, res)
    return
  }

  if (!['GET', 'POST'].includes(req.method)) {
    methodNotAllowed(res, ['GET', 'POST'])
    return
  }

  try {
    const auth = await authenticatedUser(req)
    if (!auth) {
      sendJson(res, 401, { error: 'Sign in or provide a valid Fuel bearer token.' })
      return
    }

    if (req.method === 'GET') {
      const dashboard = await getNeonDashboard(auth.id)
      dashboard.intradayEnergy = await getIntradayEnergy(auth.id)
      sendJson(res, 200, dashboard, auth.cookie ? [auth.cookie] : [])
      return
    }

    const body = unwrap(req.body)
    const description = text(body.description ?? body.food ?? body.name)
    if (!description) {
      sendJson(res, 422, { error: 'A food description is required.' })
      return
    }

    const occurredAt = validDate(body.occurredAt ?? body.occurred_at ?? body.date) || new Date()
    const db = sql()
    const rows = await db`
      INSERT INTO food_entries (
        user_id, occurred_at, meal, description, portion,
        calories_kcal, protein_g, carbs_g, fat_g, fiber_g,
        confidence, notes, source, updated_at
      ) VALUES (
        ${auth.id}, ${occurredAt.toISOString()}, ${text(body.meal)}, ${description}, ${text(body.portion)},
        ${number(body.calories ?? body.caloriesKcal ?? body.calories_kcal)},
        ${number(body.protein ?? body.proteinG ?? body.protein_g)},
        ${number(body.carbs ?? body.carbsG ?? body.carbs_g)},
        ${number(body.fat ?? body.fatG ?? body.fat_g)},
        ${number(body.fiber ?? body.fiberG ?? body.fiber_g)},
        ${text(body.confidence) || 'estimated'}, ${text(body.notes)}, ${text(body.source) || 'Fuel API'}, now()
      )
      RETURNING id, occurred_at, meal, description, portion,
        calories_kcal, protein_g, carbs_g, fat_g, fiber_g,
        confidence, notes, source
    `

    sendJson(res, 201, { ok: true, entry: rows[0] }, auth.cookie ? [auth.cookie] : [])
  } catch (error) {
    console.error(req.method === 'POST' ? 'Food logging failed' : 'Unable to load Fuel data from Neon', error)
    sendJson(res, 500, { error: req.method === 'POST' ? 'Food could not be logged.' : 'Unable to load Fuel data.' })
  }
}

async function handleUserContext(req, res) {
  if (!['GET', 'PUT'].includes(req.method)) {
    methodNotAllowed(res, ['GET', 'PUT'])
    return
  }
  try {
    const auth = await authenticatedUser(req)
    if (!auth) {
      sendJson(res, 401, { error: 'Sign in to manage Fuel context.' })
      return
    }
    const result = req.method === 'GET'
      ? await getUserContext(auth.id)
      : await saveUserContext(auth.id, unwrap(req.body).context)
    sendJson(res, 200, { ok: true, ...result }, auth.cookie ? [auth.cookie] : [])
  } catch (error) {
    console.error('Fuel user context request failed', error)
    sendJson(res, 500, { error: error instanceof Error ? error.message : 'Unable to update Fuel context.' })
  }
}

async function getIntradayEnergy(userId) {
  const db = sql()
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
  const [snapshots, foods] = await Promise.all([
    db`
      SELECT collected_at, active_energy_kcal, resting_energy_kcal, total_expenditure_kcal
      FROM health_energy_snapshots
      WHERE user_id = ${userId} AND date = ${today}::date
      ORDER BY collected_at ASC
    `,
    db`
      SELECT occurred_at, calories_kcal
      FROM food_entries
      WHERE user_id = ${userId}
        AND occurred_at >= (${today}::date::timestamp AT TIME ZONE ${TIME_ZONE})
        AND occurred_at < (((${today}::date + interval '1 day')::timestamp) AT TIME ZONE ${TIME_ZONE})
      ORDER BY occurred_at ASC
    `,
  ])

  let consumed = 0
  return {
    date: today,
    expenditure: snapshots.map((row) => ({
      collectedAt: new Date(row.collected_at).toISOString(),
      activeEnergy: finite(row.active_energy_kcal),
      restingEnergy: finite(row.resting_energy_kcal),
      totalExpenditure: finite(row.total_expenditure_kcal),
    })),
    consumed: foods.map((row) => {
      consumed += finite(row.calories_kcal) || 0
      return {
        collectedAt: new Date(row.occurred_at).toISOString(),
        caloriesConsumed: consumed,
      }
    }),
  }
}

function finite(value) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function routeFromRequest(req) {
  try {
    return new URL(req.url, 'https://fuel.rishib.com').searchParams.get('fuel_route') || ''
  } catch {
    return ''
  }
}

async function authenticatedUser(req) {
  const authorization = String(req.headers.authorization || '')
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (token) {
    const user = await userForSyncToken(token).catch(() => null)
    return user ? { id: user.id, cookie: null } : null
  }

  const { session, cookie } = await authenticatedSession(req)
  if (!session) return null
  return { id: await ensureUserFromSession(session), cookie }
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
