import { ensureUserFromSession } from './_lib/db.js'
import { authenticatedSession } from './_lib/google.js'
import { automaticallySetGoals, getUserGoals, saveUserGoals } from './_lib/goals.js'
import { methodNotAllowed, sendJson } from './_lib/http.js'

export default async function handler(req, res) {
  if (!['GET', 'PUT', 'POST'].includes(req.method)) {
    methodNotAllowed(res, ['GET', 'PUT', 'POST'])
    return
  }
  try {
    const { session, cookie } = await authenticatedSession(req)
    if (!session) {
      sendJson(res, 401, { error: 'Not authenticated' })
      return
    }
    const userId = await ensureUserFromSession(session)
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
