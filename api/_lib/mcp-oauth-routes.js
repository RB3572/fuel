import { ensureUserFromSession } from './db.js'
import { appUrl, authenticatedSession } from './google.js'
import {
  MCP_RESOURCE,
  authorizationServerMetadata,
  createAuthorizationCode,
  createConsentToken,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  oauthError,
  protectedResourceMetadata,
  readConsentToken,
  validateAuthorizeParameters,
} from './mcp-auth.js'
import { validateRegisteredOrMetadataClient } from './mcp-dcr.js'
import { methodNotAllowed, redirect, sendJson, setCookies } from './http.js'

export async function handleMcpOAuthRoute(route, req, res) {
  if (route === 'protected-resource') return metadata(req, res, protectedResourceMetadata())
  if (route === 'authorization-server') return metadata(req, res, authorizationServerMetadata())
  if (route === 'authorize') return authorize(req, res)
  if (route === 'token') return token(req, res)
  if (route === 'info') return info(req, res)
  sendJson(res, 404, { error: 'Unknown Fuel integration route.' })
}

function metadata(req, res, body) {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  res.setHeader('Cache-Control', 'public, max-age=300')
  sendJson(res, 200, body)
}

async function authorize(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    methodNotAllowed(res, ['GET', 'POST'])
    return
  }
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
  try {
    if (req.method === 'GET') return authorizeGet(req, res)
    return authorizeDecision(req, res, parseForm(req.body), true)
  } catch (error) {
    console.error('Fuel MCP authorization failed', error)
    sendHtml(res, error.statusCode || 400, errorPage(error.oauthCode || 'invalid_request', error.message || 'Unable to authorize Fuel.'))
  }
}

async function authorizeGet(req, res) {
  const requestUrl = new URL(req.url, appUrl())
  requestUrl.searchParams.delete('fuel_route')

  if (requestUrl.searchParams.has('consent_token')) {
    return authorizeDecision(req, res, Object.fromEntries(requestUrl.searchParams.entries()), false)
  }

  const parameters = validateAuthorizeParameters(Object.fromEntries(requestUrl.searchParams.entries()))
  await validateRegisteredOrMetadataClient(parameters.clientId, parameters.redirectUri)

  const { session, cookie } = await authenticatedSession(req)
  if (!session) {
    const publicAuthorizeUrl = new URL('/oauth/authorize', appUrl())
    for (const [key, value] of requestUrl.searchParams.entries()) publicAuthorizeUrl.searchParams.append(key, value)
    redirect(res, `/api/auth/google/start?return_to=${encodeURIComponent(`${publicAuthorizeUrl.pathname}${publicAuthorizeUrl.search}`)}`)
    return
  }

  await ensureUserFromSession(session)
  if (cookie) setCookies(res, [cookie])
  sendHtml(res, 200, consentPage({
    consentToken: createConsentToken(parameters),
    email: session.user?.email || '',
    name: session.user?.name || 'Fuel user',
    scopes: parameters.scopes,
  }))
}

async function authorizeDecision(req, res, body, cameFromPost) {
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
    finishAuthorization(res, target.toString(), cookie ? [cookie] : [], cameFromPost)
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
  const loopback = isLoopbackRedirect(target)
  console.info('Fuel MCP consent approved', {
    callbackOrigin: target.origin,
    callbackPath: target.pathname,
    statePresent: Boolean(consent.state),
    navigation: loopback ? 'local-redirect-bridge' : (cameFromPost ? 'post-fallback-page' : 'top-level-get-redirect'),
  })
  finishAuthorization(res, target.toString(), cookie ? [cookie] : [], cameFromPost)
}

function finishAuthorization(res, location, cookies = [], cameFromPost = false) {
  const loopback = isLoopbackRedirect(location)
  if (!cameFromPost && !loopback) {
    redirect(res, location, cookies)
    return
  }

  setCookies(res, cookies)
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; navigate-to *; base-uri 'none'; frame-ancestors 'none'")
  sendHtml(res, 200, completionPage(location, { loopback }))
}

async function token(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Pragma', 'no-cache')
  try {
    const body = parseForm(req.body)
    const grantType = String(body.grant_type || '')
    const clientId = String(body.client_id || '')
    const resource = String(body.resource || MCP_RESOURCE)
    if (!clientId) throw oauthError('invalid_client', 'client_id is required.', 401)
    if (resource !== MCP_RESOURCE) throw oauthError('invalid_target', 'The requested resource does not match Fuel MCP.')

    if (grantType === 'authorization_code') {
      const tokens = await exchangeAuthorizationCode({
        code: body.code,
        clientId,
        redirectUri: body.redirect_uri,
        resource,
        codeVerifier: body.code_verifier,
      })
      console.info('Fuel MCP authorization code exchanged', { clientId, resource })
      sendJson(res, 200, tokens)
      return
    }
    if (grantType === 'refresh_token') {
      const tokens = await exchangeRefreshToken({ refreshToken: body.refresh_token, clientId, resource })
      console.info('Fuel MCP refresh token exchanged', { clientId, resource })
      sendJson(res, 200, tokens)
      return
    }
    throw oauthError('unsupported_grant_type', 'Fuel supports authorization_code and refresh_token grants.')
  } catch (error) {
    console.error('Fuel MCP token exchange failed', error)
    if (error.oauthCode === 'invalid_client') res.setHeader('WWW-Authenticate', 'Basic realm="Fuel OAuth"')
    sendJson(res, error.statusCode || 400, {
      error: error.oauthCode || 'invalid_request',
      error_description: error.message || 'Unable to issue an OAuth token.',
    })
  }
}

function info(req, res) {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  res.setHeader('Cache-Control', 'public, max-age=300')
  sendHtml(res, 200, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fuel MCP</title><style>body{max-width:760px;margin:60px auto;padding:0 24px;font:16px/1.6 system-ui;color:#111}code{background:#eee;padding:3px 7px;border-radius:6px}h1{font-size:38px;margin-bottom:4px}h2{margin-top:32px}</style></head><body><h1>Fuel MCP</h1><p>OAuth-protected access to each user’s private Fuel health, nutrition, goals, food log, and recipe index.</p><h2>ChatGPT developer-mode setup</h2><ol><li>Enable Developer mode in ChatGPT.</li><li>Create a developer-mode plugin.</li><li>Use <code>https://fuel.rishib.com/mcp</code> as the MCP server URL.</li><li>Sign in with the same Google account used for Fuel and approve access.</li></ol><h2>Privacy</h2><p>OAuth tokens are scoped to one Fuel user. Every database query is filtered by the authenticated user ID.</p></body></html>`)
}

function parseForm(body) {
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body
  return Object.fromEntries(new URLSearchParams(Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '')).entries())
}

function consentPage({ consentToken, email, name, scopes }) {
  const permissions = scopes.map((scope) => scope === 'fuel:write'
    ? '<li>Log food and update your personal goals</li>'
    : '<li>Read your nutrition, health, fitness, goals, and recipes</li>').join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Fuel</title><style>body{margin:0;background:#f5f5f5;color:#111;font:16px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:520px;margin:8vh auto;padding:24px}.card{background:#fff;border:1px solid #ddd;border-radius:24px;padding:28px;box-shadow:0 12px 40px #0000000d}h1{margin:0 0 8px;font-size:28px}.muted{color:#666;line-height:1.5}ul{padding-left:22px;line-height:1.7}.account{background:#f5f5f5;border-radius:14px;padding:14px;margin:20px 0}.buttons{display:flex;gap:12px;margin-top:24px}button{flex:1;border-radius:12px;padding:13px 16px;font:inherit;font-weight:700;cursor:pointer}.approve{background:#111;color:#fff;border:1px solid #111}.deny{background:#fff;color:#111;border:1px solid #bbb}.fine{font-size:13px;color:#777;margin-top:20px;line-height:1.45}</style></head><body><main class="wrap"><section class="card"><h1>Connect Fuel</h1><p class="muted">An MCP client is requesting access to your private Fuel account.</p><div class="account"><strong>${escapeHtml(name)}</strong><br><span class="muted">${escapeHtml(email)}</span></div><p><strong>This connection can:</strong></p><ul>${permissions}</ul><form method="get" action="/oauth/authorize" target="_top"><input type="hidden" name="consent_token" value="${escapeHtml(consentToken)}"><div class="buttons"><button class="deny" type="submit" name="decision" value="deny">Cancel</button><button class="approve" type="submit" name="decision" value="approve">Allow</button></div></form><p class="fine">Fuel keeps each user’s data isolated in Neon. The client receives an OAuth token scoped only to this Fuel account.</p></section></main></body></html>`
}

function completionPage(location, { loopback = false } = {}) {
  const encoded = Buffer.from(location, 'utf8').toString('base64')
  const destination = loopback ? 'your local assistant' : 'the requesting client'
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0.2;url=${escapeHtml(location)}"><title>Connecting Fuel</title><style>body{margin:0;background:#f5f5f5;color:#111;font:16px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.card{max-width:520px;margin:12vh auto;background:#fff;border:1px solid #ddd;border-radius:24px;padding:28px;text-align:center}a{display:inline-block;margin-top:18px;background:#111;color:#fff;padding:13px 18px;border-radius:12px;text-decoration:none;font-weight:700}.muted{color:#666}</style></head><body><main class="card"><h1>Connecting Fuel</h1><p>Returning to ${destination}…</p><p class="muted">This window should close after authorization completes.</p><a href="${escapeHtml(location)}" target="_self">Continue</a></main><script>const target=atob('${encoded}');try{window.opener&&window.opener.postMessage({type:'fuel-mcp-oauth-redirect',url:target},'*')}catch(e){}function go(){try{window.location.replace(target)}catch(e){try{window.location.href=target}catch(_){}}}setTimeout(go,25);setTimeout(go,500)</script></body></html>`
}

function isLoopbackRedirect(value) {
  try {
    const target = value instanceof URL ? value : new URL(value)
    return target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(target.hostname)
  } catch {
    return false
  }
}

function errorPage(code, description) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fuel connection error</title><style>body{font:16px system-ui;background:#f5f5f5;color:#111}.card{max-width:560px;margin:10vh auto;background:#fff;border:1px solid #ddd;border-radius:22px;padding:28px}code{background:#eee;padding:3px 7px;border-radius:6px}</style></head><body><main class="card"><h1>Fuel could not connect</h1><p>${escapeHtml(description)}</p><p>Error: <code>${escapeHtml(code)}</code></p><p>Return to the client and try again.</p></main></body></html>`
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
