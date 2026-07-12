import { clearCookie, parseCookies, serializeCookie } from './http.js'
import { decryptJson, encryptJson } from './crypto.js'

export const sessionCookieName = 'fuel_session'
export const stateCookieName = 'fuel_oauth_state'

const tokenEndpoint = 'https://oauth2.googleapis.com/token'
const revokeEndpoint = 'https://oauth2.googleapis.com/revoke'
const userInfoEndpoint = 'https://openidconnect.googleapis.com/v1/userinfo'

export const googleScopes = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
]

export function appUrl() {
  return process.env.APP_URL || 'https://fuel.rishib.com'
}

export function redirectUri() {
  return process.env.GOOGLE_REDIRECT_URI || `${appUrl()}/api/auth/google/callback`
}

export function googleEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth environment variables are not configured')
  }

  return { clientId, clientSecret }
}

export function sessionCookie(session, maxAge = 60 * 60 * 24 * 30) {
  return serializeCookie(sessionCookieName, encryptJson(session), { maxAge })
}

export function clearSessionCookie() {
  return clearCookie(sessionCookieName)
}

export function readSession(req) {
  const cookies = parseCookies(req)
  const encrypted = cookies[sessionCookieName]

  if (!encrypted) {
    return null
  }

  return decryptJson(encrypted)
}

function compactTokenResponse(tokenResponse, previous = {}) {
  return {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token || previous.refreshToken,
    expiresAt: Date.now() + Number(tokenResponse.expires_in || 0) * 1000,
    scope: tokenResponse.scope || previous.scope,
    tokenType: tokenResponse.token_type || previous.tokenType || 'Bearer',
  }
}

export async function exchangeCode(code) {
  const { clientId, clientSecret } = googleEnv()
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
  })
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || 'Google token exchange failed')
  }

  return compactTokenResponse(payload)
}

export async function refreshSession(session) {
  if (!session?.tokens?.refreshToken) {
    return { session, cookie: null }
  }

  if (session.tokens.expiresAt && session.tokens.expiresAt > Date.now() + 90_000) {
    return { session, cookie: null }
  }

  const { clientId, clientSecret } = googleEnv()
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: session.tokens.refreshToken,
    grant_type: 'refresh_token',
  })
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new Error(payload.error_description || payload.error || 'Google token refresh failed')
  }

  const nextSession = {
    ...session,
    tokens: compactTokenResponse(payload, session.tokens),
  }

  return { session: nextSession, cookie: sessionCookie(nextSession) }
}

export async function authenticatedSession(req) {
  const session = readSession(req)

  if (!session) {
    return { session: null, cookie: null }
  }

  return refreshSession(session)
}

export async function googleFetch(session, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${session.tokens.accessToken}`,
    },
  })

  if (response.status === 204) {
    return null
  }

  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json') ? await response.json() : await response.text()

  if (!response.ok) {
    const message = typeof payload === 'object' ? payload.error?.message || payload.error : payload
    throw new Error(message || `Google API request failed: ${response.status}`)
  }

  return payload
}

export async function getUserInfo(session) {
  return googleFetch(session, userInfoEndpoint)
}

export async function revokeSession(session) {
  const token = session?.tokens?.refreshToken || session?.tokens?.accessToken

  if (!token) {
    return
  }

  await fetch(revokeEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  }).catch(() => null)
}
