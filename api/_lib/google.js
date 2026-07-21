import { clearCookie, parseCookies, serializeCookie } from './http.js'
import { decryptJson, encryptJson } from './crypto.js'

export const sessionCookieName = 'fuel_session'
export const stateCookieName = 'fuel_oauth_state'

const tokenEndpoint = 'https://oauth2.googleapis.com/token'
const revokeEndpoint = 'https://oauth2.googleapis.com/revoke'
const userInfoEndpoint = 'https://openidconnect.googleapis.com/v1/userinfo'

export const geminiGoogleScope = 'https://www.googleapis.com/auth/cloud-platform'
export const googleScopes = ['openid', 'email', 'profile', geminiGoogleScope]

export function appUrl() {
  return process.env.APP_URL || 'https://fuel.rishib.com'
}

export function redirectUri() {
  return process.env.GOOGLE_REDIRECT_URI || `${appUrl()}/api/auth/google/callback`
}

export function googleEnv() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Google OAuth environment variables are not configured')
  return { clientId, clientSecret }
}

export function googleQuotaProject() {
  const configured = process.env.GEMINI_QUOTA_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT
  if (configured) return configured
  const { clientId } = googleEnv()
  const projectNumber = String(clientId).match(/^(\d+)-/)?.[1]
  if (!projectNumber) throw new Error('Set GEMINI_QUOTA_PROJECT to the Google Cloud project ID that owns the OAuth client.')
  return projectNumber
}

export function hasGoogleScope(session, requiredScope) {
  const scopes = String(session?.tokens?.scope || '').split(/\s+/).filter(Boolean)
  return scopes.includes(requiredScope)
}

export function sessionCookie(session, maxAge = 60 * 60 * 24 * 30) {
  return serializeCookie(sessionCookieName, encryptJson(session), { maxAge })
}

export function clearSessionCookie() {
  return clearCookie(sessionCookieName)
}

export function readSession(req) {
  const encrypted = parseCookies(req)[sessionCookieName]
  return encrypted ? decryptJson(encrypted) : null
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
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri(), grant_type: 'authorization_code' }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error_description || payload.error || 'Google token exchange failed')
  return compactTokenResponse(payload)
}

export async function refreshSession(session) {
  if (!session?.tokens?.refreshToken || (session.tokens.expiresAt && session.tokens.expiresAt > Date.now() + 90_000)) {
    return { session, cookie: null }
  }
  const { clientId, clientSecret } = googleEnv()
  try {
    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: session.tokens.refreshToken, grant_type: 'refresh_token' }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error_description || payload.error || 'Google token refresh failed')
    const nextSession = { ...session, tokens: compactTokenResponse(payload, session.tokens) }
    return { session: nextSession, cookie: sessionCookie(nextSession) }
  } catch (error) {
    // The signed session cookie carries the user's identity, and the flows that call
    // this — the dashboard, MCP OAuth, food logging, meal planner — need only that,
    // not a live Google access token (they run on Neon + the Gemini API key). A dead
    // or revoked Google refresh token (e.g. Google's 7-day testing-mode expiry) must
    // not break them, so keep the existing session instead of throwing. Flows that
    // genuinely need a live token (Google Sheets import) surface their own 401 via
    // googleFetch.
    console.warn('Google token refresh failed; continuing with existing session identity.', error?.message || error)
    return { session, cookie: null }
  }
}

export async function authenticatedSession(req) {
  const session = readSession(req)
  if (!session) return { session: null, cookie: null }
  return refreshSession(session)
}

export async function googleFetch(session, url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${session.tokens.accessToken}` } })
  if (response.status === 204) return null
  const contentType = response.headers.get('content-type') || ''
  const payload = contentType.includes('application/json') ? await response.json() : await response.text()
  if (!response.ok) throw new Error((typeof payload === 'object' ? payload.error?.message || payload.error : payload) || `Google API request failed: ${response.status}`)
  return payload
}

export async function getUserInfo(session) {
  return googleFetch(session, userInfoEndpoint)
}

export async function revokeSession(session) {
  const token = session?.tokens?.refreshToken || session?.tokens?.accessToken
  if (!token) return
  await fetch(revokeEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) }).catch(() => null)
}
