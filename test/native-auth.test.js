import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

// The identity-token verifier is the only thing standing between a stranger and someone
// else's Fuel account, so it gets exercised for real: tokens are signed with a locally
// generated key, the JWKS fetch is stubbed to serve its public half, and every check —
// signature, issuer, audience, expiry, algorithm — is attacked individually.

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }

const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value))
  .toString('base64url')

function signToken(claims, { kid = 'test-key', alg = 'RS256', key = privateKey } = {}) {
  const header = b64({ alg, kid, typ: 'JWT' })
  const payload = b64(claims)
  if (alg === 'none') return `${header}.${payload}.${b64('not-a-signature')}`
  const signature = crypto.sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key)
    .toString('base64url')
  return `${header}.${payload}.${signature}`
}

const appleClaims = (overrides = {}) => ({
  iss: 'https://appleid.apple.com',
  aud: 'com.labloggercompany.fuel.web',
  sub: '000123.abc',
  email: 'someone@example.com',
  exp: Math.floor(Date.now() / 1000) + 600,
  iat: Math.floor(Date.now() / 1000),
  ...overrides,
})

const originalFetch = globalThis.fetch
globalThis.fetch = async () => ({ ok: true, json: async () => ({ keys: [jwk] }) })
const { verifyAppleIdentityToken, mintNativeHandoffCode, redeemNativeHandoffCode } =
  await import('../api/_lib/native-auth.js')
test.after(() => { globalThis.fetch = originalFetch })

const audience = ['com.labloggercompany.fuel.web']

test('a correctly signed Apple token verifies and yields its claims', async () => {
  const claims = await verifyAppleIdentityToken(signToken(appleClaims()), audience)
  assert.equal(claims.email, 'someone@example.com')
  assert.equal(claims.sub, '000123.abc')
})

test('a token signed by the wrong key is rejected', async () => {
  const attacker = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  await assert.rejects(
    () => verifyAppleIdentityToken(signToken(appleClaims(), { key: attacker }), audience),
    /signature is invalid/,
  )
})

test('a tampered payload is rejected even though the signature is well-formed', async () => {
  // Swap the email for someone else's after signing: the classic account-takeover.
  const token = signToken(appleClaims())
  const [header, , signature] = token.split('.')
  const forged = `${header}.${b64(appleClaims({ email: 'victim@example.com' }))}.${signature}`
  await assert.rejects(() => verifyAppleIdentityToken(forged, audience), /signature is invalid/)
})

test('the alg:none downgrade is refused', async () => {
  await assert.rejects(
    () => verifyAppleIdentityToken(signToken(appleClaims(), { alg: 'none' }), audience),
    /Unsupported identity token algorithm/,
  )
})

test('a token for a different app is refused', async () => {
  await assert.rejects(
    () => verifyAppleIdentityToken(signToken(appleClaims({ aud: 'com.someone.else' })), audience),
    /issued for a different app/,
  )
})

test('a token from the wrong issuer is refused', async () => {
  await assert.rejects(
    () => verifyAppleIdentityToken(signToken(appleClaims({ iss: 'https://evil.example' })), audience),
    /unexpected issuer/,
  )
})

test('an expired token is refused', async () => {
  await assert.rejects(
    () => verifyAppleIdentityToken(signToken(appleClaims({ exp: Math.floor(Date.now() / 1000) - 30 })), audience),
    /has expired/,
  )
})

test('a token signed by an unknown key is refused', async () => {
  await assert.rejects(
    () => verifyAppleIdentityToken(signToken(appleClaims(), { kid: 'not-a-real-kid' }), audience),
    /unknown key/,
  )
})

// MARK: the Google handoff
//
// The app opens Fuel's own Google flow and gets a one-time code back over the fuel://
// scheme. Any app can register that scheme, so the code is bound to a PKCE challenge:
// intercepting it must not be enough to redeem it.

process.env.TOKEN_ENCRYPTION_KEY ||= Buffer.alloc(32, 9).toString('base64')

const s256 = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url')

test('a handoff code redeems with the verifier that produced its challenge', () => {
  const verifier = 'a-long-random-verifier-value'
  const code = mintNativeHandoffCode({ userId: 'user-1', codeChallenge: s256(verifier) })
  assert.equal(redeemNativeHandoffCode(code, verifier).userId, 'user-1')
})

test('an intercepted handoff code is useless without the verifier', () => {
  const code = mintNativeHandoffCode({ userId: 'user-1', codeChallenge: s256('the-real-verifier') })
  assert.throws(() => redeemNativeHandoffCode(code, 'a-guess'), /issued for a different request/)
  assert.throws(() => redeemNativeHandoffCode(code, ''), /issued for a different request/)
})

test('a handoff code with no challenge at all is refused', () => {
  // Belt and braces: a code minted without PKCE must not be redeemable by passing
  // an empty verifier whose hash happens to match an empty challenge.
  const code = mintNativeHandoffCode({ userId: 'user-1', codeChallenge: '' })
  assert.throws(() => redeemNativeHandoffCode(code, ''), /issued for a different request/)
})

test('an expired handoff code is refused', () => {
  const verifier = 'v'
  const code = mintNativeHandoffCode({ userId: 'user-1', codeChallenge: s256(verifier) })
  const realNow = Date.now
  Date.now = () => realNow() + 10 * 60 * 1000
  try {
    assert.throws(() => redeemNativeHandoffCode(code, verifier), /has expired/)
  } finally {
    Date.now = realNow
  }
})

test('a token from somewhere else is not a handoff code', () => {
  assert.throws(() => redeemNativeHandoffCode('not-a-code', 'v'))
})

// MARK: wiring

test('both surfaces offer Google and Apple, and share one verifier', () => {
  const native = read('../api/_lib/native-auth.js')
  const app = read('../src/App.tsx')
  const mlog = read('../api/mlog.js')

  // The website: both buttons, matched by email so either lands on the same account.
  assert.match(app, /\/api\/auth\/google\/start/)
  assert.match(app, /\/api\/auth\/apple\/start/)

  // The web Apple callback and the app's native endpoint verify with the same code.
  assert.match(native, /export async function verifyAppleIdentityToken/)
  assert.match(native, /export async function handleAppleCallback/)
  assert.match(native, /await verifyAppleIdentityToken\(identityToken, \[process\.env\.APPLE_SERVICE_ID\]\)/)

  // Routed through mlog rather than as new functions — the project is at its limit.
  assert.match(mlog, /integrationRoute === 'native-auth'/)
  assert.match(mlog, /integrationRoute === 'apple-callback'/)

  const config = JSON.parse(read('../vercel.json'))
  for (const source of ['/api/auth/native', '/api/auth/apple/start', '/api/auth/apple/callback']) {
    assert.ok(config.rewrites.some((rule) => rule.source === source), `${source} must be routed`)
  }
})

test('the app signs in natively with the same identity, not a Fuel consent page', () => {
  const signIn = read('../ios/Fuel/Sources/SignIn.swift')
  // Apple goes through the system sheet.
  assert.match(signIn, /ASAuthorizationAppleIDProvider/)
  // Google goes through Fuel's existing Google flow — the user sees Google's own
  // account picker. Crucially NOT /oauth/authorize, which is the MCP consent screen.
  assert.match(signIn, /\/api\/auth\/google\/start/)
  assert.doesNotMatch(signIn, /\/oauth\/authorize/)
  assert.match(signIn, /\/api\/auth\/native/)
  assert.doesNotMatch(signIn, /client_secret/)
})

test('the Google handoff never puts tokens in the redirect URL', () => {
  const callback = read('../api/auth/google/callback.js')
  // A code bound to PKCE, not an access token a scheme-hijacker could simply read.
  assert.match(callback, /fuel:\/\/auth\?code=/)
  assert.doesNotMatch(callback, /fuel:\/\/auth\?access_token/)
  // And no browser session is set for the app's flow.
  assert.match(callback, /redirect\(res, `fuel:\/\/auth\?code=\$\{encodeURIComponent\(handoff\)\}`, baseCookies\)/)
})
