import { sql } from './db.js'

const MAX_CONTEXT_LENGTH = 20000

export async function ensureUserContextTable() {
  const db = sql()
  await db`
    CREATE TABLE IF NOT EXISTS user_context (
      user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
      context text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `
}

export async function getUserContext(userId) {
  await ensureUserContextTable()
  const db = sql()
  const rows = await db`
    SELECT context, updated_at
    FROM user_context
    WHERE user_id = ${userId}
    LIMIT 1
  `
  return {
    context: rows[0]?.context || '',
    updatedAt: rows[0]?.updated_at || null,
  }
}

export async function saveUserContext(userId, value) {
  const context = normalizeContext(value)
  await ensureUserContextTable()
  const db = sql()
  const rows = await db`
    INSERT INTO user_context (user_id, context, updated_at)
    VALUES (${userId}, ${context}, now())
    ON CONFLICT (user_id) DO UPDATE SET
      context = EXCLUDED.context,
      updated_at = now()
    RETURNING context, updated_at
  `
  return { context: rows[0].context, updatedAt: rows[0].updated_at }
}

export async function appendUserContext(userId, addition) {
  const text = normalizeContext(addition)
  if (!text) return getUserContext(userId)
  const current = await getUserContext(userId)
  const combined = current.context.trim()
    ? `${current.context.trim()}\n\n${text}`
    : text
  return saveUserContext(userId, combined)
}

function normalizeContext(value) {
  const context = String(value ?? '').trim()
  if (context.length > MAX_CONTEXT_LENGTH) {
    throw new Error(`Fuel context cannot exceed ${MAX_CONTEXT_LENGTH} characters.`)
  }
  return context
}
