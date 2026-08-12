import {
  MCP_RESOURCE,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  oauthError,
} from '../_lib/mcp-auth.js'
import { methodNotAllowed, sendJson } from '../_lib/http.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }

  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Pragma', 'no-cache')

  try {
    const body = parseBody(req.body)
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
      sendJson(res, 200, tokens)
      return
    }

    if (grantType === 'refresh_token') {
      const tokens = await exchangeRefreshToken({
        refreshToken: body.refresh_token,
        clientId,
        resource,
      })
      sendJson(res, 200, tokens)
      return
    }

    throw oauthError('unsupported_grant_type', 'Fuel supports authorization_code and refresh_token grants.')
  } catch (error) {
    console.error('Fuel MCP token exchange failed', error)
    if (error.oauthCode === 'invalid_client') {
      res.setHeader('WWW-Authenticate', 'Basic realm="Fuel OAuth"')
    }
    sendJson(res, error.statusCode || 400, {
      error: error.oauthCode || 'invalid_request',
      error_description: error.message || 'Unable to issue an OAuth token.',
    })
  }
}

function parseBody(body) {
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) return body
  return Object.fromEntries(new URLSearchParams(Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '')).entries())
}
