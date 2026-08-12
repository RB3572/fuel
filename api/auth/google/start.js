import { randomToken, signState } from '../../_lib/crypto.js'
import { appUrl, geminiGoogleScope, googleEnv, googleScopes, redirectUri, stateCookieName } from '../../_lib/google.js'
import { redirect, serializeCookie } from '../../_lib/http.js'

const returnCookieName = 'fuel_oauth_return'
// Set when the Fuel iOS app starts the flow, so the callback hands the result back to
// the app instead of setting a browser session.
const nativeCookieName = 'fuel_native_pkce'

export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.end('Method not allowed')
    return
  }

  const requestUrl = new URL(req.url, appUrl())
  const connectGemini = requestUrl.searchParams.get('gemini') === '1'
  // The app asks for openid/email/profile only — it never needs Google API access —
  // and proves possession of the request with PKCE.
  const nativeChallenge = requestUrl.searchParams.get('native') === '1'
    ? String(requestUrl.searchParams.get('code_challenge') || '')
    : ''
  const scopes = connectGemini ? [...googleScopes, geminiGoogleScope] : googleScopes
  const { clientId } = googleEnv()
  const state = randomToken(24)
  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')

  authorizationUrl.searchParams.set('client_id', clientId)
  authorizationUrl.searchParams.set('redirect_uri', redirectUri())
  authorizationUrl.searchParams.set('response_type', 'code')
  authorizationUrl.searchParams.set('scope', scopes.join(' '))
  authorizationUrl.searchParams.set('access_type', 'offline')
  authorizationUrl.searchParams.set('prompt', 'consent')
  authorizationUrl.searchParams.set('include_granted_scopes', 'true')
  authorizationUrl.searchParams.set('state', state)

  const cookies = [serializeCookie(stateCookieName, signState(state), { maxAge: 10 * 60 })]
  if (nativeChallenge) cookies.push(serializeCookie(nativeCookieName, nativeChallenge, { maxAge: 10 * 60 }))
  const returnTo = safeReturnTo(req)
  if (returnTo !== '/') cookies.push(serializeCookie(returnCookieName, returnTo, { maxAge: 10 * 60 }))
  redirect(res, authorizationUrl.toString(), cookies)
}

function safeReturnTo(req) {
  try {
    const requestUrl = new URL(req.url, appUrl())
    const raw = requestUrl.searchParams.get('return_to')
    if (!raw) return '/'
    const target = new URL(raw, appUrl())
    if (target.origin !== new URL(appUrl()).origin || target.pathname.startsWith('//')) return '/'
    return `${target.pathname}${target.search}`
  } catch {
    return '/'
  }
}
