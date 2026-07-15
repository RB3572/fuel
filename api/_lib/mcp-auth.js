import crypto from 'node:crypto'
import { decryptJson, encryptJson, randomToken } from './crypto.js'
import { sql, tokenHash } from './db.js'
import { appUrl } from './google.js'

export const MCP_SCOPES = ['fuel:read', 'fuel:write']
export const MCP_RESOURCE = `${appUrl()}/mcp`
export const MCP_ISSUER = appUrl()

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 90
const AUTH_CODE_TTL_SECONDS = 5 * 60
const CONSENT_TTL_SECONDS = 10 * 60

export async function ensureMcpOAuthTables() {
  const db = sql()
  await db`
    CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      code_hash text NOT NULL UNIQUE,
      user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      client_id text NOT NULL,
      redirect_uri text NOT NULL,
      resource text NOT NULL,
      scope text NOT NULL,
      code_challenge text NOT NULL,
      expires_at timestamptz NOT NULL,
      consumed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `
  await db`
    CREATE TABLE IF NOT EXISTS mcp_oauth_refresh_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      token_hash text NOT NULL UNIQUE,
      user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      client_id text NOT NULL,
      resource text NOT NULL,
      scope text NOT NULL,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      last_used_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `
}

export function protectedResourceMetadata() {
  return {
    resource: MCP_RESOURCE,
    authorization_servers: [MCP_ISSUER],
    scopes_supported: MCP_SCOPES,
    bearer_methods_supported: ['header'],
    resource_documentation: `${appUrl()}/mcp-info`,
  }
}

export function authorizationServerMetadata() {
  return {
    issuer: MCP_ISSUER,
    authorization_endpoint: `${appUrl()}/oauth/authorize`,
    token_endpoint: `${appUrl()}/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    scopes_supported: MCP_SCOPES,
    service_documentation: `${appUrl()}/mcp-info`,
  }
}

export function normalizeScopes(input) {
  const requested = String(input || 'fuel:read fuel:write')
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
  const unique = [...new Set(requested)]
  if (!unique.length || unique.some((scope) => !MCP_SCOPES.includes(scope))) {
    throw oauthError('invalid_scope', 'Requested scope is not supported.')
  }
  return unique
}

export function validateAuthorizeParameters(params) {
  const responseType = String(params.response_type || '')
  const clientId = String(params.client_id || '')
  const redirectUri = String(params.redirect_uri || '')
  const codeChallenge = String(params.code_challenge || '')
  const codeChallengeMethod = String(params.code_challenge_method || '')
  const resource = String(params.resource || '')

  if (responseType !== 'code') throw oauthError('unsupported_response_type', 'Only the authorization code flow is supported.')
  if (!clientId || !redirectUri) throw oauthError('invalid_request', 'client_id and redirect_uri are required.')
  if (!codeChallenge || codeChallengeMethod !== 'S256') throw oauthError('invalid_request', 'PKCE with S256 is required.')
  if (resource !== MCP_RESOURCE) throw oauthError('invalid_target', 'The OAuth resource does not match the Fuel MCP server.')

  const scopes = normalizeScopes(params.scope)
  return {
    responseType,
    clientId,
    redirectUri,
    codeChallenge,
    codeChallengeMethod,
    resource,
    scopes,
    state: params.state == null ? '' : String(params.state),
  }
}

export async function validateClientRedirect(clientId, redirectUri) {
  let clientUrl
  let redirectUrl
  try {
    clientUrl = new URL(clientId)
    redirectUrl = new URL(redirectUri)
  } catch {
    throw oauthError('invalid_client', 'Fuel requires a valid HTTPS Client ID Metadata Document URL.')
  }
  if (clientUrl.protocol !== 'https:' || redirectUrl.protocol !== 'https:') {
    throw oauthError('invalid_client', 'OAuth client and redirect URLs must use HTTPS.')
  }

  let metadata
  try {
    const response = await fetch(clientUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    metadata = await response.json()
  } catch (error) {
    throw oauthError('invalid_client', `Unable to validate the OAuth client metadata: ${error instanceof Error ? error.message : 'unknown error'}`)
  }

  const redirectUris = Array.isArray(metadata?.redirect_uris) ? metadata.redirect_uris.map(String) : []
  if (!redirectUris.includes(redirectUri)) {
    throw oauthError('invalid_redirect_uri', 'The redirect URI is not listed in the client metadata document.')
  }
  return metadata
}

export function createConsentToken(parameters) {
  return encryptJson({
    type: 'mcp_oauth_consent',
    ...parameters,
    exp: Date.now() + CONSENT_TTL_SECONDS * 1000,
    nonce: randomToken(16),
  })
}

export function readConsentToken(token) {
  try {
    const payload = decryptJson(String(token || ''))
    if (payload?.type !== 'mcp_oauth_consent' || Number(payload.exp) < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export async function createAuthorizationCode({ userId, clientId, redirectUri, resource, scopes, codeChallenge }) {
  await ensureMcpOAuthTables()
  const code = randomToken(48)
  const db = sql()
  await db`
    INSERT INTO mcp_oauth_codes (
      code_hash, user_id, client_id, redirect_uri, resource, scope, code_challenge, expires_at
    ) VALUES (
      ${tokenHash(code)}, ${userId}, ${clientId}, ${redirectUri}, ${resource}, ${scopes.join(' ')},
      ${codeChallenge}, now() + (${AUTH_CODE_TTL_SECONDS} * interval '1 second')
    )
  `
  return code
}

export async function exchangeAuthorizationCode({ code, clientId, redirectUri, resource, codeVerifier }) {
  await ensureMcpOAuthTables()
  const db = sql()
  const rows = await db`
    SELECT * FROM mcp_oauth_codes
    WHERE code_hash = ${tokenHash(String(code || ''))}
      AND consumed_at IS NULL
      AND expires_at > now()
      AND client_id = ${String(clientId || '')}
      AND redirect_uri = ${String(redirectUri || '')}
      AND resource = ${String(resource || '')}
    LIMIT 1
  `
  const row = rows[0]
  if (!row) throw oauthError('invalid_grant', 'Authorization code is invalid, expired, or already used.')
  if (!verifyCodeChallenge(codeVerifier, row.code_challenge)) {
    throw oauthError('invalid_grant', 'PKCE code verification failed.')
  }

  const consumed = await db`
    UPDATE mcp_oauth_codes
    SET consumed_at = now()
    WHERE id = ${row.id} AND consumed_at IS NULL
    RETURNING id
  `
  if (!consumed.length) throw oauthError('invalid_grant', 'Authorization code has already been used.')

  return issueTokenPair({
    userId: row.user_id,
    clientId: row.client_id,
    resource: row.resource,
    scopes: normalizeScopes(row.scope),
  })
}

export async function exchangeRefreshToken({ refreshToken, clientId, resource }) {
  await ensureMcpOAuthTables()
  const db = sql()
  const rows = await db`
    SELECT * FROM mcp_oauth_refresh_tokens
    WHERE token_hash = ${tokenHash(String(refreshToken || ''))}
      AND revoked_at IS NULL
      AND expires_at > now()
      AND client_id = ${String(clientId || '')}
      AND resource = ${String(resource || '')}
    LIMIT 1
  `
  const row = rows[0]
  if (!row) throw oauthError('invalid_grant', 'Refresh token is invalid, expired, or revoked.')

  const revoked = await db`
    UPDATE mcp_oauth_refresh_tokens
    SET revoked_at = now(), last_used_at = now()
    WHERE id = ${row.id} AND revoked_at IS NULL
    RETURNING id
  `
  if (!revoked.length) throw oauthError('invalid_grant', 'Refresh token has already been used.')

  return issueTokenPair({
    userId: row.user_id,
    clientId: row.client_id,
    resource: row.resource,
    scopes: normalizeScopes(row.scope),
  })
}

export async function issueTokenPair({ userId, clientId, resource, scopes }) {
  await ensureMcpOAuthTables()
  const now = Math.floor(Date.now() / 1000)
  const accessToken = encryptJson({
    type: 'mcp_access_token',
    iss: MCP_ISSUER,
    aud: resource,
    sub: String(userId),
    userId: String(userId),
    clientId: String(clientId),
    scope: scopes.join(' '),
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
    jti: randomToken(16),
  })
  const refreshToken = `fuel_mcp_rt_${randomToken(48)}`
  const db = sql()
  await db`
    INSERT INTO mcp_oauth_refresh_tokens (
      token_hash, user_id, client_id, resource, scope, expires_at
    ) VALUES (
      ${tokenHash(refreshToken)}, ${userId}, ${clientId}, ${resource}, ${scopes.join(' ')},
      now() + (${REFRESH_TOKEN_TTL_SECONDS} * interval '1 second')
    )
  `
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: scopes.join(' '),
  }
}

export function verifyAccessToken(token, requiredScopes = []) {
  try {
    const payload = decryptJson(String(token || ''))
    const now = Math.floor(Date.now() / 1000)
    if (payload?.type !== 'mcp_access_token') return null
    if (payload.iss !== MCP_ISSUER || payload.aud !== MCP_RESOURCE) return null
    if (!payload.userId || Number(payload.exp) <= now || Number(payload.iat) > now + 60) return null
    const scopes = normalizeScopes(payload.scope)
    if (requiredScopes.some((scope) => !scopes.includes(scope))) return null
    return { ...payload, scopes }
  } catch {
    return null
  }
}

export function bearerToken(req) {
  const authorization = String(req.headers.authorization || '')
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
}

export function oauthChallenge(scope = 'fuel:read') {
  return `Bearer resource_metadata="${appUrl()}/.well-known/oauth-protected-resource", scope="${scope}", error="insufficient_scope", error_description="Connect your Fuel account to continue"`
}

export function oauthError(code, description, status = 400) {
  const error = new Error(description)
  error.oauthCode = code
  error.statusCode = status
  return error
}

function verifyCodeChallenge(verifier, expectedChallenge) {
  const normalized = String(verifier || '')
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(normalized)) return false
  const actual = crypto.createHash('sha256').update(normalized).digest('base64url')
  return timingSafeEqual(actual, String(expectedChallenge || ''))
}

function timingSafeEqual(left, right) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
