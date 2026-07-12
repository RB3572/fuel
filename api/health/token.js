import { encryptJson } from '../_lib/crypto.js'
import { authenticatedSession } from '../_lib/google.js'
import { methodNotAllowed, sendJson } from '../_lib/http.js'

const TOKEN_KIND = 'fuel-health-import'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }

  const { session, cookie } = await authenticatedSession(req)
  if (!session?.tokens?.refreshToken) {
    sendJson(res, 401, { error: 'Sign in to Fuel before generating a health sync token.' })
    return
  }

  const token = encryptJson({
    kind: TOKEN_KIND,
    issuedAt: Date.now(),
    session,
  })

  sendJson(res, 200, {
    token,
    endpoint: 'https://fuel.rishib.com/api/health/import',
    note: 'Use this token only in Health.md. Disconnecting Google Drive revokes the underlying Google authorization.',
  }, cookie ? [cookie] : [])
}
