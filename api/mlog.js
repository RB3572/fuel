import { ensureUserFromSession } from './_lib/db.js'
import { authenticatedSession } from './_lib/google.js'
import { methodNotAllowed, sendJson } from './_lib/http.js'
import { getNeonDashboard } from './_lib/neon-dashboard.js'

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
    const dashboard = await getNeonDashboard(userId)
    sendJson(res, 200, dashboard, cookie ? [cookie] : [])
  } catch (error) {
    console.error('Unable to load Fuel data from Neon', error)
    sendJson(res, 500, { error: 'Unable to load Fuel data.' })
  }
}
