import { verifyStateCookie } from '../../_lib/crypto.js'
import { upsertUser } from '../../_lib/db.js'
import {
  clearSessionCookie,
  exchangeCode,
  getUserInfo,
  sessionCookie,
  stateCookieName,
  appUrl,
} from '../../_lib/google.js'
import { clearCookie, parseCookies, redirect } from '../../_lib/http.js'
import { mintNativeHandoffCode } from '../../_lib/native-auth.js'

const returnCookieName = 'fuel_oauth_return'
const nativeCookieName = 'fuel_native_pkce'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.end('Method not allowed')
    return
  }

  const url = new URL(req.url, appUrl())
  const code = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')
  const cookies = parseCookies(req)
  const expectedState = verifyStateCookie(cookies[stateCookieName])
  const returnTo = safeReturnTo(cookies[returnCookieName])
  const nativeChallenge = cookies[nativeCookieName] || ''
  const baseCookies = [clearCookie(stateCookieName), clearCookie(returnCookieName), clearCookie(nativeCookieName)]

  if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
    redirect(res, '/?auth_error=invalid_state', [...baseCookies, clearSessionCookie()])
    return
  }

  try {
    const tokens = await exchangeCode(code)
    const provisional = { tokens, createdAt: Date.now() }
    const googleUser = await getUserInfo(provisional)
    const dbUser = await upsertUser(googleUser)
    const nextSession = {
      ...provisional,
      userId: dbUser.id,
      user: {
        email: dbUser.email,
        name: dbUser.name,
        picture: dbUser.picture_url,
      },
    }
    if (nativeChallenge) {
      // The Fuel iOS app started this. Hand back a short-lived code bound to its PKCE
      // challenge rather than a token in a URL, and set no browser session — the phone
      // exchanges the code for its own tokens over POST.
      const handoff = mintNativeHandoffCode({ userId: dbUser.id, codeChallenge: nativeChallenge })
      redirect(res, `fuel://auth?code=${encodeURIComponent(handoff)}`, baseCookies)
      return
    }
    redirect(res, returnTo, [...baseCookies, sessionCookie(nextSession)])
  } catch (error) {
    console.error('Google sign in failed', error)
    if (nativeChallenge) {
      redirect(res, 'fuel://auth?error=sign_in_failed', baseCookies)
      return
    }
    redirect(res, '/?auth_error=token_exchange_failed', [...baseCookies, clearSessionCookie()])
  }
}

function safeReturnTo(raw) {
  try {
    if (!raw) return '/'
    const target = new URL(raw, appUrl())
    if (target.origin !== new URL(appUrl()).origin || target.pathname.startsWith('//')) return '/'
    return `${target.pathname}${target.search}`
  } catch {
    return '/'
  }
}
