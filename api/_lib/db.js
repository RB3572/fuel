import crypto from 'node:crypto'
import { neon } from '@neondatabase/serverless'
import { decryptJson, encryptJson } from './crypto.js'

// NEW_FUEL_DATABASE_URL first, DATABASE_URL only as the fallback. The Neon integration
// for the current database registers itself under the NEW_FUEL_ prefix (a second Neon
// install cannot claim the unprefixed names), while DATABASE_URL still points at the
// original project. Preferring the prefixed one is what actually moves the app across;
// leaving DATABASE_URL as a fallback keeps any environment that never got the new
// integration — a preview branch, a local .env — working instead of failing to boot.
export function sql() {
  const url = process.env.NEW_FUEL_DATABASE_URL || process.env.DATABASE_URL
  if (!url) throw new Error('No database URL is configured (NEW_FUEL_DATABASE_URL or DATABASE_URL)')
  return neon(url)
}

export async function upsertUser(user) {
  if (!user?.email) throw new Error('Google account email is required')
  const db = sql()
  const rows = await db`
    INSERT INTO app_users (google_sub, email, name, picture_url, updated_at)
    VALUES (${String(user.sub || user.email)}, ${String(user.email)}, ${user.name || null}, ${user.picture || null}, now())
    ON CONFLICT (email) DO UPDATE SET
      google_sub = EXCLUDED.google_sub,
      name = EXCLUDED.name,
      picture_url = EXCLUDED.picture_url,
      updated_at = now()
    RETURNING id, email, name, picture_url
  `
  return rows[0]
}

export async function ensureUserFromSession(session) {
  // Resolve the CURRENT app_users id from the Google identity rather than trusting the
  // cookie's userId. The session cookie lives 30 days and can outlive its row (e.g. the
  // users table was reset and re-seeded with new UUIDs), and a stale id then violates
  // the app_users foreign keys on mcp_oauth_codes / tokens / etc. Upsert by email is
  // idempotent and self-healing: it returns the live id for the signed-in account.
  if (session?.user?.email) return (await upsertUser(session.user)).id
  if (session?.userId) return session.userId
  throw new Error('Fuel session is missing a Google identity.')
}

export function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export function newSyncToken() {
  return `fuel_${crypto.randomBytes(32).toString('base64url')}`
}

function encryptToken(token) {
  return encryptJson({ token })
}

function decryptToken(ciphertext) {
  try {
    return decryptJson(ciphertext)?.token || null
  } catch {
    return null
  }
}

export async function getOrCreateSyncToken(userId) {
  if (!userId) throw new Error('Authenticated user ID is required')
  const db = sql()
  const existing = await db`
    SELECT id, token_prefix, token_ciphertext, created_at, last_used_at
    FROM sync_tokens
    WHERE user_id = ${userId} AND revoked_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
  `
  if (existing.length) {
    const token = decryptToken(existing[0].token_ciphertext)
    if (token) return { ...existing[0], token }
  }
  return rotateSyncToken(userId)
}

export async function rotateSyncToken(userId) {
  if (!userId) throw new Error('Authenticated user ID is required')
  const db = sql()
  await db`UPDATE sync_tokens SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`
  const token = newSyncToken()
  const rows = await db`
    INSERT INTO sync_tokens (user_id, token_hash, token_prefix, token_ciphertext)
    VALUES (${userId}, ${tokenHash(token)}, ${token.slice(0, 12)}, ${encryptToken(token)})
    RETURNING id, token_prefix, created_at, last_used_at
  `
  return { ...rows[0], token }
}

export async function userForSyncToken(token) {
  if (!token) return null
  const db = sql()
  const hash = tokenHash(token)
  const rows = await db`
    SELECT u.id, u.email, u.name
    FROM sync_tokens t
    JOIN app_users u ON u.id = t.user_id
    WHERE t.token_hash = ${hash} AND t.revoked_at IS NULL
    LIMIT 1
  `
  if (!rows.length) return null
  await db`UPDATE sync_tokens SET last_used_at = now() WHERE token_hash = ${hash}`
  return rows[0]
}
