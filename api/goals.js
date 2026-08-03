import { ensureUserFromSession, userForSyncToken } from './_lib/db.js'
import { authenticatedSession } from './_lib/google.js'
import { verifyAccessToken } from './_lib/mcp-auth.js'
import { automaticallySetGoals, getUserGoals, saveUserGoals } from './_lib/goals.js'
import { methodNotAllowed, sendJson } from './_lib/http.js'

export default async function handler(req, res) {
  if (!['GET', 'PUT', 'POST'].includes(req.method)) {
    methodNotAllowed(res, ['GET', 'PUT', 'POST'])
    return
  }
  try {
    // Same three credentials the rest of the API accepts, in the same order: the
    // long-lived sync token, an OAuth access token, then the browser session. Goals were
    // session-only, which left the iOS app able to show targets but never edit them.
    const auth = await authenticated(req, req.method === 'GET' ? ['fuel:read'] : ['fuel:write'])
    if (!auth) {
      sendJson(res, 401, { error: 'Not authenticated' })
      return
    }
    const { userId, cookie } = auth
    if (req.method === 'GET') {
      sendJson(res, 200, await getUserGoals(userId), cookie ? [cookie] : [])
      return
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    const goals = req.method === 'POST'
      ? await automaticallySetGoals(userId, body)
      : await saveUserGoals(userId, body)
    sendJson(res, 200, goals, cookie ? [cookie] : [])
  } catch (error) {
    console.error('Unable to update Fuel goals', error)
    sendJson(res, 400, { error: error instanceof Error ? error.message : 'Unable to update goals.' })
  }
}

async function authenticated(req, requiredScopes = []) {
  const authorization = String(req.headers.authorization || '')
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (token) {
    const user = await userForSyncToken(token).catch(() => null)
    if (user) return { userId: user.id, cookie: null }
    const granted = verifyAccessToken(token, requiredScopes)
    return granted ? { userId: granted.userId, cookie: null } : null
  }
  const { session, cookie } = await authenticatedSession(req)
  if (!session) return null
  return { userId: await ensureUserFromSession(session), cookie }
}
