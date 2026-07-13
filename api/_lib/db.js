import crypto from 'node:crypto'
import { neon } from '@neondatabase/serverless'
import { decryptJson, encryptJson } from './crypto.js'

const LEGACY_EMAIL = 'legacy@fuel.local'

export function sql() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not configured')
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
  await claimLegacyData(rows[0].id)
  return rows[0]
}

async function claimLegacyData(userId) {
  const db = sql()
  const legacy = await db`SELECT id FROM app_users WHERE email = ${LEGACY_EMAIL} LIMIT 1`
  if (!legacy.length || legacy[0].id === userId) return

  const existing = await db`
    SELECT
      (SELECT count(*) FROM health_daily WHERE user_id = ${userId}) +
      (SELECT count(*) FROM food_entries WHERE user_id = ${userId}) +
      (SELECT count(*) FROM supplements WHERE user_id = ${userId}) +
      (SELECT count(*) FROM recipes WHERE user_id = ${userId}) AS total
  `
  if (Number(existing[0]?.total || 0) > 0) return

  await db.transaction([
    db`UPDATE health_daily SET user_id = ${userId} WHERE user_id = ${legacy[0].id}`,
    db`UPDATE food_entries SET user_id = ${userId} WHERE user_id = ${legacy[0].id}`,
    db`UPDATE supplements SET user_id = ${userId} WHERE user_id = ${legacy[0].id}`,
    db`UPDATE recipes SET user_id = ${userId} WHERE user_id = ${legacy[0].id}`,
  ])
}

export async function ensureUserFromSession(session) {
  if (session?.userId) return session.userId
  const user = await upsertUser(session?.user)
  return user.id
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
