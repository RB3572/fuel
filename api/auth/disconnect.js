import { clearSessionCookie, readSession, revokeSession } from '../_lib/google.js'
import { methodNotAllowed, sendJson } from '../_lib/http.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }

  const session = readSession(req)

  if (session) {
    await revokeSession(session)
  }

  sendJson(res, 200, { ok: true }, [clearSessionCookie()])
}
