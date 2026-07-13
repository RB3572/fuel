import { authenticatedSession } from './_lib/google.js'
import { getMLogDashboard } from './_lib/mlog-enhanced.js'
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

    const dashboard = await getMLogDashboard(session)

    sendJson(res, 200, dashboard, cookie ? [cookie] : [])
  } catch (error) {
    console.error('Unable to load MLog', error)
    sendJson(res, 500, {
      error: 'Unable to load MLog. Refresh the page or reconnect Google Drive.',
    })
  }
}
