import { randomToken } from './crypto.js'
import { sql } from './db.js'
import { oauthError, validateClientRedirect } from './mcp-auth.js'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export async function ensureMcpClientTable() {
  const db = sql()
  await db`
    CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
      client_id text PRIMARY KEY,
      client_name text,
      redirect_uris jsonb NOT NULL,
      grant_types jsonb NOT NULL,
      response_types jsonb NOT NULL,
      token_endpoint_auth_method text NOT NULL,
      metadata jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `
}

export async function registerDynamicClient(body) {
  const redirectUris = normalizeRedirectUris(body?.redirect_uris)
  const grantTypes = normalizeStringArray(body?.grant_types, ['authorization_code', 'refresh_token'])
  const responseTypes = normalizeStringArray(body?.response_types, ['code'])
  const tokenEndpointAuthMethod = String(body?.token_endpoint_auth_method || 'none')

  if (!redirectUris.length) throw oauthError('invalid_client_metadata', 'At least one redirect_uri is required.')
  for (const uri of redirectUris) validateRedirectUri(uri)
  if (grantTypes.some((value) => !['authorization_code', 'refresh_token'].includes(value))) {
    throw oauthError('invalid_client_metadata', 'Fuel supports authorization_code and refresh_token grants.')
  }
  if (responseTypes.some((value) => value !== 'code')) {
    throw oauthError('invalid_client_metadata', 'Fuel supports only the code response type.')
  }
  if (tokenEndpointAuthMethod !== 'none') {
    throw oauthError('invalid_client_metadata', 'Fuel supports public OAuth clients using token_endpoint_auth_method none.')
  }

  await ensureMcpClientTable()
  const clientId = `fuel_dcr_${randomToken(24)}`
  const metadata = {
    client_id: clientId,
    client_name: String(body?.client_name || 'Fuel MCP client').slice(0, 200),
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: responseTypes,
    token_endpoint_auth_method: 'none',
    application_type: String(body?.application_type || 'native'),
  }
  const db = sql()
  await db`
    INSERT INTO mcp_oauth_clients (
      client_id, client_name, redirect_uris, grant_types, response_types,
      token_endpoint_auth_method, metadata
    ) VALUES (
      ${clientId}, ${metadata.client_name}, ${JSON.stringify(redirectUris)}::jsonb,
      ${JSON.stringify(grantTypes)}::jsonb, ${JSON.stringify(responseTypes)}::jsonb,
      'none', ${JSON.stringify(metadata)}::jsonb
    )
  `
  return metadata
}

export async function validateRegisteredOrMetadataClient(clientId, redirectUri) {
  await ensureMcpClientTable()
  const db = sql()
  const rows = await db`
    SELECT redirect_uris, metadata
    FROM mcp_oauth_clients
    WHERE client_id = ${String(clientId || '')}
    LIMIT 1
  `
  if (rows.length) {
    const redirectUris = Array.isArray(rows[0].redirect_uris) ? rows[0].redirect_uris.map(String) : []
    if (!redirectUris.includes(String(redirectUri || ''))) {
      throw oauthError('invalid_redirect_uri', 'The redirect URI is not registered for this OAuth client.')
    }
    return rows[0].metadata || { client_id: clientId, redirect_uris: redirectUris }
  }
  return validateClientRedirect(clientId, redirectUri)
}

function normalizeRedirectUris(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
}

function normalizeStringArray(value, fallback) {
  if (!Array.isArray(value) || !value.length) return fallback
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
}

function validateRedirectUri(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw oauthError('invalid_redirect_uri', 'Every redirect URI must be a valid absolute URL.')
  }
  const isHttps = url.protocol === 'https:'
  const isLoopbackHttp = url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
  if (!isHttps && !isLoopbackHttp) {
    throw oauthError('invalid_redirect_uri', 'Redirect URIs must use HTTPS, except HTTP loopback redirects for local clients.')
  }
  if (url.hash) throw oauthError('invalid_redirect_uri', 'Redirect URIs must not contain a fragment.')
}
