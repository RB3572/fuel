import crypto from 'node:crypto'
import { upsertUser } from './db.js'
import { issueTokenPair } from './mcp-auth.js'
import { methodNotAllowed, sendJson, clearCookie, parseCookies, redirect, serializeCookie } from './http.js'
import { randomToken, signState, verifyStateCookie } from './crypto.js'
import { appUrl, clearSessionCookie, sessionCookie, stateCookieName } from './google.js'

// Native sign-in for the Fuel iOS app.
//
// The website signs in with Google and keys every user row on their email address.
// The app signs in with the *same* identity — the phone gets an ID token from Google
// or Apple, posts it here, and this verifies the signature itself and upserts on that
// same email. So the app and the website are the same account by construction: sign in
// with Apple on the phone using the address you use for Google on the web, and you land
// on the same data.
//
// What comes back is an ordinary Fuel OAuth token pair, the kind api/mlog.js already
// accepts, so nothing downstream needs to know how the user proved who they were.

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com']
const APPLE_ISSUER = 'https://appleid.apple.com'
const RESOURCE = 'https://fuel.rishib.com/mcp'

// JWKS are cached: they rotate rarely and a fetch per sign-in is a needless dependency
// on someone else's uptime during the one operation that must work.
const jwksCache = new Map()

async function jwks(url) {
  const cached = jwksCache.get(url)
  if (cached && cached.expires > Date.now()) return cached.keys
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Could not fetch signing keys from ${url}`)
  const { keys } = await response.json()
  jwksCache.set(url, { keys, expires: Date.now() + 60 * 60 * 1000 })
  return keys
}

function base64url(input) {
  return Buffer.from(String(input).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/// Verifies an RS256 JWT against a JWKS and returns its claims. Deliberately hand-rolled
/// rather than pulling in a library: it is thirty lines, and the checks that matter
/// (signature, issuer, audience, expiry) are then visible in one place.
async function verifyIdToken(token, { jwksUrl, issuers, audiences }) {
  const [headerPart, payloadPart, signaturePart] = String(token || '').split('.')
  if (!headerPart || !payloadPart || !signaturePart) throw new Error('Malformed identity token.')

  const header = JSON.parse(base64url(headerPart).toString('utf8'))
  const claims = JSON.parse(base64url(payloadPart).toString('utf8'))
  if (header.alg !== 'RS256') throw new Error('Unsupported identity token algorithm.')

  const key = (await jwks(jwksUrl)).find((candidate) => candidate.kid === header.kid)
  if (!key) throw new Error('Identity token was signed by an unknown key.')

  const publicKey = crypto.createPublicKey({ key, format: 'jwk' })
  const verified = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${headerPart}.${payloadPart}`),
    publicKey,
    base64url(signaturePart),
  )
  if (!verified) throw new Error('Identity token signature is invalid.')

  const now = Math.floor(Date.now() / 1000)
  if (!issuers.includes(claims.iss)) throw new Error('Identity token came from an unexpected issuer.')
  if (Number(claims.exp) <= now) throw new Error('Identity token has expired.')
  if (audiences.length && !audiences.includes(claims.aud)) {
    throw new Error('Identity token was issued for a different app.')
  }
  return claims
}

/// Shared with the website's Apple callback, so there is one verifier, not two.
export async function verifyAppleIdentityToken(token, audiences = []) {
  return verifyIdToken(token, {
    jwksUrl: 'https://appleid.apple.com/auth/keys',
    issuers: [APPLE_ISSUER],
    audiences: audiences.filter(Boolean),
  })
}

function audiencesFor(provider) {
  const configured = provider === 'google'
    ? [process.env.GOOGLE_IOS_CLIENT_ID, process.env.GOOGLE_CLIENT_ID]
    : [process.env.APPLE_BUNDLE_ID || 'com.labloggercompany.fuel', process.env.APPLE_SERVICE_ID]
  return configured.filter(Boolean)
}

/// POST /api/auth/native  { provider: 'google' | 'apple', idToken, name? }
export async function handleNativeAuth(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res, ['POST'])
    return
  }
  const body = unwrap(req.body)
  const provider = String(body.provider || '').toLowerCase()
  const idToken = String(body.idToken || body.identityToken || '')

  if (!['google', 'apple'].includes(provider)) {
    sendJson(res, 400, { error: 'provider must be "google" or "apple".' })
    return
  }
  if (!idToken) {
    sendJson(res, 400, { error: 'An identity token is required.' })
    return
  }

  try {
    const claims = provider === 'google'
      ? await verifyIdToken(idToken, {
        jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
        issuers: GOOGLE_ISSUERS,
        audiences: audiencesFor('google'),
      })
      : await verifyIdToken(idToken, {
        jwksUrl: 'https://appleid.apple.com/auth/keys',
        issuers: [APPLE_ISSUER],
        audiences: audiencesFor('apple'),
      })

    // Apple only sends the email on the very first authorization, and only sends the
    // name in the authorization response rather than the token — so the client passes
    // what it was given and we fall back to the stable subject.
    const email = claims.email || body.email
    if (!email) {
      sendJson(res, 400, {
        error: 'This sign-in did not include an email address, so it cannot be matched to a Fuel account.',
      })
      return
    }

    const user = await upsertUser({
      sub: claims.sub,
      email,
      name: body.name || claims.name || null,
      picture: claims.picture || null,
    })

    const tokens = await issueTokenPair({
      userId: user.id,
      clientId: `fuel-${provider}-native`,
      resource: RESOURCE,
      scopes: ['fuel:read', 'fuel:write'],
    })

    sendJson(res, 200, {
      ...tokens,
      user: { email: user.email, name: user.name, picture: user.picture_url },
    })
  } catch (error) {
    // A bad token is the client's problem, not a server fault; say which without
    // leaking the verification internals.
    sendJson(res, 401, { error: error.message || 'That sign-in could not be verified.' })
  }
}

function unwrap(body) {
  if (Buffer.isBuffer(body)) return unwrap(body.toString('utf8'))
  if (typeof body === 'string') {
    try { return JSON.parse(body) } catch { return {} }
  }
  return body && typeof body === 'object' ? body : {}
}


// MARK: Sign in with Apple, web half — same session cookie the Google flow sets.

export function handleAppleStart(req, res) {
  if (req.method !== 'GET') {
    res.statusCode = 405
    res.end('Method not allowed')
    return
  }

  const serviceId = process.env.APPLE_SERVICE_ID
  if (!serviceId) {
    res.statusCode = 503
    res.end('Sign in with Apple is not configured. Set APPLE_SERVICE_ID.')
    return
  }

  const state = randomToken(24)
  const authorizationUrl = new URL('https://appleid.apple.com/auth/authorize')
  authorizationUrl.searchParams.set('client_id', serviceId)
  authorizationUrl.searchParams.set('redirect_uri', `${appUrl()}/api/auth/apple/callback`)
  authorizationUrl.searchParams.set('response_type', 'code id_token')
  authorizationUrl.searchParams.set('scope', 'name email')
  // form_post is mandatory when name/email scopes are requested.
  authorizationUrl.searchParams.set('response_mode', 'form_post')
  authorizationUrl.searchParams.set('state', state)

  const cookies = [serializeCookie(stateCookieName, signState(state), { maxAge: 10 * 60 })]
  redirect(res, authorizationUrl.toString(), cookies)
}


export async function handleAppleCallback(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end('Method not allowed')
    return
  }

  const form = new URLSearchParams(await readBody(req))
  const identityToken = form.get('id_token')
  const returnedState = form.get('state')
  const cookies = parseCookies(req)
  const expectedState = verifyStateCookie(cookies[stateCookieName])
  const baseCookies = [clearCookie(stateCookieName)]

  if (!identityToken || !returnedState || !expectedState || returnedState !== expectedState) {
    redirect(res, '/?auth_error=invalid_state', [...baseCookies, clearSessionCookie()])
    return
  }

  try {
    const claims = await verifyAppleIdentityToken(identityToken, [process.env.APPLE_SERVICE_ID])
    // Apple sends the name once, as JSON in the form body, and never in the token.
    let name = null
    try {
      const user = JSON.parse(form.get('user') || '{}')
      name = [user?.name?.firstName, user?.name?.lastName].filter(Boolean).join(' ') || null
    } catch { /* the name is optional and only ever arrives once */ }

    if (!claims.email) {
      redirect(res, '/?auth_error=apple_no_email', [...baseCookies, clearSessionCookie()])
      return
    }

    const dbUser = await upsertUser({ sub: claims.sub, email: claims.email, name })
    const session = {
      // No Google tokens: an Apple sign-in proves identity, and everything Fuel needs
      // after that is keyed on the user row, not on Google's API access.
      tokens: {},
      createdAt: Date.now(),
      userId: dbUser.id,
      user: { email: dbUser.email, name: dbUser.name, picture: dbUser.picture_url },
    }
    redirect(res, '/', [...baseCookies, sessionCookie(session)])
  } catch (error) {
    console.error('Apple sign-in failed', error)
    redirect(res, '/?auth_error=apple_failed', [...baseCookies, clearSessionCookie()])
  }
}

function readBody(req) {
  if (typeof req.body === 'string') return Promise.resolve(req.body)
  if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString('utf8'))
  if (req.body && typeof req.body === 'object') {
    return Promise.resolve(new URLSearchParams(req.body).toString())
  }
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

