import { verifyStateCookie } from '../../_lib/crypto.js'
import {
  clearSessionCookie,
  exchangeCode,
  getUserInfo,
  sessionCookie,
  stateCookieName,
} from '../../_lib/google.js'
import { appUrl } from '../../_lib/google.js'
import { clearCookie, parseCookies, redirect } from '../../_lib/http.js'

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
  const baseCookies = [clearCookie(stateCookieName)]

  if (!code || !returnedState || !expectedState || returnedState !== expectedState) {
    redirect(res, '/?auth_error=invalid_state', [...baseCookies, clearSessionCookie()])
    return
  }

  try {
    const tokens = await exchangeCode(code)
    const session = { tokens, createdAt: Date.now() }
    const user = await getUserInfo(session).catch(() => null)
    const nextSession = {
      ...session,
      user: user
        ? {
            email: user.email,
            name: user.name,
            picture: user.picture,
          }
        : null,
    }

    redirect(res, '/', [...baseCookies, sessionCookie(nextSession)])
  } catch {
    redirect(res, '/?auth_error=token_exchange_failed', [...baseCookies, clearSessionCookie()])
  }
}
