import { decryptJson } from '../_lib/crypto.js'
import { refreshSession } from '../_lib/google.js'
import { importHealthPayload } from '../_lib/health-import.js'
import { methodNotAllowed, sendJson } from '../_lib/http.js'

const MLOG_SPREADSHEET_ID = '1XWOQPqQJ4pbN93tQty-jDuiqv7_8CgEfNPVTD0k8MIs'
const TOKEN_KIND = 'fuel-health-import'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }

  const header = String(req.headers.authorization || '')
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) {
    sendJson(res, 401, { error: 'A Fuel health sync bearer token is required.' })
    return
  }

  let session
  try {
    const payload = decryptJson(token)
    if (payload?.kind !== TOKEN_KIND || !payload?.session?.tokens?.refreshToken) throw new Error('Invalid token')
    const refreshed = await refreshSession(payload.session)
    session = refreshed.session
  } catch {
    sendJson(res, 401, { error: 'Invalid or expired Fuel health sync token.' })
    return
  }

  const contentType = String(req.headers['content-type'] || '')
  if (!contentType.includes('application/json')) {
    sendJson(res, 415, { error: 'Content-Type must be application/json.' })
    return
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    if (!payload || typeof payload !== 'object') {
      sendJson(res, 400, { error: 'A JSON object or array is required.' })
      return
    }

    // Reuse the same Google OAuth grant established when the user connected Fuel.
    // The importer writes only to the user's known MLog spreadsheet.
    process.env.MLOG_SPREADSHEET_ID = MLOG_SPREADSHEET_ID
    process.env.GOOGLE_REFRESH_TOKEN = session.tokens.refreshToken

    const result = await importHealthPayload(payload)
    sendJson(res, 200, { ok: true, ...result })
  } catch (error) {
    console.error('Health import failed', error instanceof Error ? error.message : 'Unknown error')
    sendJson(res, 500, {
      error: 'Health data could not be imported. Reconnect Fuel and generate a new health sync token.',
    })
  }
}
