import { authorizationServerMetadata } from '../_lib/mcp-auth.js'
import { methodNotAllowed, sendJson } from '../_lib/http.js'

export default function handler(req, res) {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  res.setHeader('Cache-Control', 'public, max-age=300')
  sendJson(res, 200, authorizationServerMetadata())
}
