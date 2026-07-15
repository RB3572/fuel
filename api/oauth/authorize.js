import { ensureUserFromSession } from '../_lib/db.js'
import { appUrl, authenticatedSession } from '../_lib/google.js'
import {
  createAuthorizationCode,
  createConsentToken,
  readConsentToken,
  validateAuthorizeParameters,
  validateClientRedirect,
} from '../_lib/mcp-auth.js'
import { methodNotAllowed, redirect, setCookies } from '../_lib/http.js'

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    methodNotAllowed(res, ['GET', 'POST'])
    return
  }

  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")

  try {
    if (req.method === 'GET') {
      await handleGet(req, res)
      return
    }
    await handlePost(req, res)
  } catch (error) {
    console.error('Fuel MCP authorization failed', error)
    sendHtml(res, error.statusCode || 400, errorPage(error.oauthCode || 'invalid_request', error.message || 'Unable to authorize Fuel.'))
  }
}

async function handleGet(req, res) {
  const requestUrl = new URL(req.url, appUrl())
  const parameters = validateAuthorizeParameters(Object.fromEntries(requestUrl.searchParams.entries()))
  await validateClientRedirect(parameters.clientId, parameters.redirectUri)

  const { session, cookie } = await authenticatedSession(req)
  if (!session) {
    const returnTo = `${requestUrl.pathname}${requestUrl.search}`
    redirect(res, `/api/auth/google/start?return_to=${encodeURIComponent(returnTo)}`)
    return
  }

  const userId = await ensureUserFromSession(session)
  const consentToken = createConsentToken(parameters)
  if (cookie) setCookies(res, [cookie])
  sendHtml(res, 200, consentPage({
    consentToken,
    email: session.user?.email || '',
    name: session.user?.name || 'Fuel user',
    userId,
    scopes: parameters.scopes,
  }))
}

async function handlePost(req, res) {
  const body = parseBody(req.body)
  const consent = readConsentToken(body.consent_token)
  if (!consent) throw oauthFailure('invalid_request', 'The authorization request expired. Return to ChatGPT and try connecting again.')

  const { session, cookie } = await authenticatedSession(req)
  if (!session) throw oauthFailure('login_required', 'Sign in to Fuel before approving access.', 401)
  const userId = await ensureUserFromSession(session)

  const target = new URL(consent.redirectUri)
  if (body.decision !== 'approve') {
    target.searchParams.set('error', 'access_denied')
    target.searchParams.set('error_description', 'The user declined access to Fuel.')
    if (consent.state) target.searchParams.set('state', consent.state)
    redirect(res, target.toString(), cookie ? [cookie] : [])
    return
  }

  const code = await createAuthorizationCode({
    userId,
    clientId: consent.clientId,
    redirectUri: consent.redirectUri,
    resource: consent.resource,
    scopes: consent.scopes,
    codeChallenge: consent.codeChallenge,
  })
  target.searchParams.set('code', code)
  if (consent.state) target.searchParams.set('state', consent.state)
  redirect(res, target.toString(), cookie ? [cookie] : [])
}

function parseBody(body) {
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body
  return Object.fromEntries(new URLSearchParams(Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '')).entries())
}

function consentPage({ consentToken, email, name, scopes }) {
  const permissions = scopes.map((scope) => scope === 'fuel:write'
    ? '<li>Log food and update your personal goals</li>'
    : '<li>Read your nutrition, health, fitness, goals, and recipes</li>').join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Fuel</title>
<style>body{margin:0;background:#f5f5f5;color:#111;font:16px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:520px;margin:8vh auto;padding:24px}.card{background:#fff;border:1px solid #ddd;border-radius:24px;padding:28px;box-shadow:0 12px 40px #0000000d}h1{margin:0 0 8px;font-size:28px}.muted{color:#666;line-height:1.5}ul{padding-left:22px;line-height:1.7}.account{background:#f5f5f5;border-radius:14px;padding:14px;margin:20px 0}.buttons{display:flex;gap:12px;margin-top:24px}button{flex:1;border-radius:12px;padding:13px 16px;font:inherit;font-weight:700;cursor:pointer}.approve{background:#111;color:#fff;border:1px solid #111}.deny{background:#fff;color:#111;border:1px solid #bbb}.fine{font-size:13px;color:#777;margin-top:20px;line-height:1.45}</style></head>
<body><main class="wrap"><section class="card"><h1>Connect Fuel to ChatGPT</h1><p class="muted">ChatGPT is requesting access to your private Fuel account.</p><div class="account"><strong>${escapeHtml(name)}</strong><br><span class="muted">${escapeHtml(email)}</span></div><p><strong>This connection can:</strong></p><ul>${permissions}</ul><form method="post" action="/oauth/authorize"><input type="hidden" name="consent_token" value="${escapeHtml(consentToken)}"><div class="buttons"><button class="deny" type="submit" name="decision" value="deny">Cancel</button><button class="approve" type="submit" name="decision" value="approve">Allow</button></div></form><p class="fine">Fuel keeps each user’s data isolated in Neon. ChatGPT receives an OAuth token scoped only to this Fuel account. You can revoke access by signing out or rotating credentials.</p></section></main></body></html>`
}

function errorPage(code, description) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fuel connection error</title><style>body{font:16px system-ui;background:#f5f5f5;color:#111}.card{max-width:560px;margin:10vh auto;background:#fff;border:1px solid #ddd;border-radius:22px;padding:28px}code{background:#eee;padding:3px 7px;border-radius:6px}</style></head><body><main class="card"><h1>Fuel could not connect</h1><p>${escapeHtml(description)}</p><p>Error: <code>${escapeHtml(code)}</code></p><p>Return to ChatGPT and try again.</p></main></body></html>`
}

function sendHtml(res, statusCode, html) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(html)
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character])
}

function oauthFailure(code, message, statusCode = 400) {
  const error = new Error(message)
  error.oauthCode = code
  error.statusCode = statusCode
  return error
}
