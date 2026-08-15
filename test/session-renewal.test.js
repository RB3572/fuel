import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

// Signing in and then being told an hour later that "that token was rejected" was one
// bug wearing three coats: the server hard-revoked a refresh token the instant it was
// redeemed, so a reply lost on a waking radio stranded the phone on a token the table
// had already killed; the app swallowed the resulting failure and sent the expired
// access token anyway; and the 401 that came back blamed a Settings field that has not
// existed since sign-in replaced pasted tokens. These pin all three shut.

const auth = read('../api/_lib/mcp-auth.js')
const signIn = read('../ios/Fuel/Sources/SignIn.swift')
const client = read('../ios/Fuel/Sources/FuelClient.swift')
const store = read('../ios/Fuel/Sources/AppStore.swift')

test('a rotated refresh token stays redeemable briefly, so a lost reply is recoverable', () => {
  // The lookup must no longer filter on `revoked_at IS NULL` alone — that is precisely
  // the condition that made a dropped response permanent.
  assert.match(auth, /const REFRESH_ROTATION_GRACE_SECONDS = 60/)
  assert.match(
    auth,
    /revoked_at IS NULL\s*\n\s*OR revoked_at > now\(\) - \(\$\{REFRESH_ROTATION_GRACE_SECONDS\} \* interval '1 second'\)/,
  )
})

test('redeeming inside the grace window does not push the window forward', () => {
  // Without COALESCE each retry would re-stamp revoked_at and the token would stay
  // alive for as long as anything kept asking — a 60-second grace with no end.
  assert.match(auth, /SET revoked_at = COALESCE\(revoked_at, now\(\)\), last_used_at = now\(\)/)
})

test('the grace window is the only relaxation: an unknown or expired grant still fails', () => {
  assert.match(auth, /AND expires_at > now\(\)/)
  assert.match(auth, /if \(!row\) throw oauthError\('invalid_grant'/)
})

test('a renewal that did not renew yields no token rather than the expired one', () => {
  // Returning the stale access token is what turned a failed renewal into a 401, which
  // read to the user as a rejected credential instead of a connection that failed.
  assert.match(signIn, /guard let current = self\.tokens, current\.isFresh else \{ return nil \}/)
  assert.doesNotMatch(signIn, /^\s*return self\.tokens\?\.accessToken$/m)
})

test('only an invalid_grant ends the session; a failed connection changes nothing', () => {
  // A 500, a captive portal, or no signal at all must not cost a session that is
  // almost certainly still good.
  assert.match(signIn, /case renewed, tryAgainLater, grantIsDead/)
  assert.match(
    signIn,
    /return object\?\["error"\] as\? String == "invalid_grant" \? \.grantIsDead : \.tryAgainLater/,
  )
  assert.match(signIn, /guard let \(data, response\) = try\? await URLSession\.shared\.data\(for: request\),\s*\n\s*let http = response as\? HTTPURLResponse else \{ return \.tryAgainLater \}/)
  // A dead grant signs out, so RootView shows the sign-in screen — the actual next step.
  assert.match(signIn, /case \.grantIsDead:[\s\S]{0,400}?signOut\(\)/)
})

test('the token is renewed while the app is still awake, not at the wire', () => {
  assert.match(signIn, /expiresAt > Date\(\)\.addingTimeInterval\(5 \* 60\)/)
})

test('no error still sends the user to a Settings token field that was removed', () => {
  assert.doesNotMatch(client, /Check it in Settings|Add your Fuel token in Settings/)
  assert.match(client, /case sessionUnavailable/)
  assert.match(client, /case \.unauthorized: return "Your session has expired\. Sign in again\."/)
  // A session that could not be renewed is a different thing from a malformed base URL,
  // and the two used to share notConfigured's "add your token" copy.
  assert.match(store, /guard let token = await auth\.accessToken\(\) else \{ throw FuelClientError\.sessionUnavailable \}/)
})
