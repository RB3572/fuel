import { methodNotAllowed } from './_lib/http.js'

export default function handler(req, res) {
  if (req.method !== 'GET') {
    methodNotAllowed(res, ['GET'])
    return
  }
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fuel MCP</title><style>body{max-width:760px;margin:60px auto;padding:0 24px;font:16px/1.6 system-ui;color:#111}code{background:#eee;padding:3px 7px;border-radius:6px}h1{font-size:38px;margin-bottom:4px}h2{margin-top:32px}</style></head><body><h1>Fuel MCP</h1><p>OAuth-protected access to each user’s private Fuel health, nutrition, goals, food log, and recipe index.</p><h2>ChatGPT developer-mode setup</h2><ol><li>Enable Developer mode in ChatGPT.</li><li>Create a developer-mode plugin.</li><li>Use <code>https://fuel.rishib.com/mcp</code> as the MCP server URL.</li><li>When prompted, sign in with the same Google account used for Fuel and approve the requested permissions.</li></ol><h2>Available operations</h2><p>Read dashboard and health data, list food entries, log food, read or update goals, automatically calculate goals, and browse saved recipes.</p><h2>Privacy</h2><p>OAuth tokens are scoped to one Fuel user. Every database query is filtered by the authenticated user ID.</p></body></html>`)
}
