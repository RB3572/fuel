import { importHealthPayload, verifyImportToken } from '../_lib/health-import.js'
import { methodNotAllowed, sendJson } from '../_lib/http.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }

  const auth = verifyImportToken(req)
  if (!auth.ok) {
    sendJson(res, auth.status, { error: auth.error })
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

    const result = await importHealthPayload(payload)
    sendJson(res, 200, { ok: true, ...result })
  } catch (error) {
    console.error('Health import failed', error instanceof Error ? error.message : 'Unknown error')
    sendJson(res, 500, {
      error: 'Health data could not be imported. Check the Fuel server configuration and payload format.',
    })
  }
}
