import { ensureUserFromSession, getOrCreateSyncToken, rotateSyncToken } from '../_lib/db.js'
import { authenticatedSession } from '../_lib/google.js'
import { bearerToken, verifyAccessToken } from '../_lib/mcp-auth.js'
import { methodNotAllowed, sendJson } from '../_lib/http.js'

const SHORTCUT_URL = 'https://www.icloud.com/shortcuts/0895a9a876fa454f8e2bc90daa555fc7'

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    methodNotAllowed(res, ['GET', 'POST'])
    return
  }

  try {
    // The website calls this with its session cookie. The Fuel iOS app has no cookie —
    // it authenticates with its OAuth access token, same as the rest of its API
    // traffic — so it can fetch its own sync token to sync with, rather than a
    // person copy-pasting one from the website into the app (this endpoint mints the
    // token; /api/health/sync/v1 itself stays sync-token-only, on purpose).
    const granted = verifyAccessToken(bearerToken(req), ['fuel:read'])
    let userId
    let cookie = null
    if (granted) {
      userId = granted.userId
    } else {
      const authed = await authenticatedSession(req)
      if (!authed.session) {
        sendJson(res, 401, { error: 'Sign in to Fuel before viewing a health sync token.' })
        return
      }
      userId = await ensureUserFromSession(authed.session)
      cookie = authed.cookie
    }

    const record = req.method === 'POST' ? await rotateSyncToken(userId) : await getOrCreateSyncToken(userId)

    sendJson(res, 200, {
      token: record.token,
      tokenPrefix: record.token_prefix,
      createdAt: record.created_at,
      lastUsedAt: record.last_used_at,
      endpoint: 'https://fuel.rishib.com/api/health/import',
      shortcutUrl: SHORTCUT_URL,
      instructions: 'Install the shortcut, then replace its Authorization header token with this token. Keep the word Bearer and one space before the token.',
    }, cookie ? [cookie] : [])
  } catch (error) {
    console.error('Unable to provide sync token', error)
    sendJson(res, 500, { error: 'Unable to provide a health sync token.' })
  }
}
