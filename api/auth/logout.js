import { clearSessionCookie } from '../_lib/google.js'
import { methodNotAllowed, sendJson } from '../_lib/http.js'

export default function handler(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }

  sendJson(res, 200, { ok: true }, [clearSessionCookie()])
}
