import { randomToken, signState } from '../../_lib/crypto.js'
import { googleEnv, googleScopes, redirectUri, stateCookieName } from '../../_lib/google.js'
import { redirect, serializeCookie } from '../../_lib/http.js'

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.end('Method not allowed')
    return
  }

  const { clientId } = googleEnv()
  const state = randomToken(24)
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')

  authorizationUrl.searchParams.set('client_id', clientId)
  authorizationUrl.searchParams.set('redirect_uri', redirectUri())
  authorizationUrl.searchParams.set('response_type', 'code')
  authorizationUrl.searchParams.set('scope', googleScopes.join(' '))
  authorizationUrl.searchParams.set('access_type', 'offline')
  authorizationUrl.searchParams.set('prompt', 'consent')
  authorizationUrl.searchParams.set('state', state)

  redirect(res, authorizationUrl.toString(), [
    serializeCookie(stateCookieName, signState(state), { maxAge: 10 * 60 }),
  ])
}
