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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.end('Method not allowed')
    return
  }

  const url = new URL(req.url, appUrl())
  const code = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')
  const expectedState = verifyStateCookie(parseCookies(req)[stateCookieName])
  const baseCookies = [clearCookie(stateCookieName)]

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
    redirect(res, '/', [...baseCookies, sessionCookie(nextSession)])
  } catch (error) {
    console.error('Google sign in failed', error)
    redirect(res, '/?auth_error=token_exchange_failed', [...baseCookies, clearSessionCookie()])
  }
}
