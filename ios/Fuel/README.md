# Fuel for iOS

A native companion to [fuel.rishib.com](https://fuel.rishib.com), on the same database
and the same API. The website is unchanged and stays the primary surface.

```bash
cd ios/Fuel && xcodegen generate && open Fuel.xcodeproj
```

Three things make it different from the website:

- **The AI runs on device.** `FoundationModels` replaces every Gemini call — nutrition
  estimates, photo identification, the coach. No key, no quota, no round trip, and food
  photos never leave the phone. Requires iOS 26 and an Apple Intelligence device.
- **HealthKit is read directly.** No Shortcut, no Health Logger. The sync engine is
  shared with Health Logger by source path, so there is one implementation.
- **Logging opens the camera.** One tap captures, identifies and logs; the blue button
  stops for context first. Typing is one tap away.

## Sign-in

Both surfaces offer Google and Apple. Fuel matches accounts **by email address**, so
signing in with Apple on the phone and Google on the web lands on the same data —
provided the address matches and you don't use Apple's private relay.

The phone posts the provider's ID token to `POST /api/auth/native`, which verifies the
signature against the provider's JWKS and returns an ordinary Fuel token pair. See
`api/_lib/native-auth.js`; the verifier is tested against forged, tampered, expired and
downgraded tokens in `test/native-auth.test.js`.

### What still needs configuring

| What | Where | Needed for |
|---|---|---|
| App ID `com.labloggercompany.fuel` with **HealthKit** + **Sign in with Apple** | Apple Developer portal | ✅ registered |
| `GOOGLE_IOS_CLIENT_ID` | Vercel env | ✅ set |
| Google iOS client + reversed scheme | `ios/Fuel/project.yml` | ✅ set |
| `APPLE_SERVICE_ID` | Vercel env | Sign in with Apple, **web only** |

**Google runs natively.** The system browser opens `accounts.google.com` — the same
account picker the website shows — and the app comes back holding an ID token that
`/api/auth/native` verifies against Google's JWKS. iOS OAuth clients are public by
design, so the client ID ships in the app and PKCE is what makes the exchange safe;
there is no secret anywhere in the bundle.

If no iOS client is configured, it falls back to brokering through Fuel's own Google flow
at `/api/auth/google/start?native=1`, which needs no client at all: the callback hands
back a one-time code over `fuel://auth`, bound to a PKCE challenge so an app that
hijacked the scheme cannot redeem it. Self-hosters get something that works either way.
That binding is attacked directly in `test/native-auth.test.js`.

The redirect scheme must be the reversed client ID. If the two disagree the sheet opens,
the user signs in, and the callback never arrives — with no error anywhere — so a test
asserts they match.

**Sign in with Apple in the app** needs only the capability, which is registered. Build
with your team and it runs; the simulator additionally needs an Apple ID signed in under
Settings.

**Sign in with Apple on the web** additionally needs a Services ID:

1. Apple Developer portal → Identifiers → **Services IDs** → register e.g.
   `com.labloggercompany.fuel.web`.
2. Configure it against `fuel.rishib.com` with return URL
   `https://fuel.rishib.com/api/auth/apple/callback`, and verify the domain by hosting
   the association file Apple gives you at `public/.well-known/`.
3. `vercel env add APPLE_SERVICE_ID production`.

No Apple private key is needed: the web flow uses `response_type=code id_token` with
`response_mode=form_post` and verifies the returned `id_token` directly, so there is no
client-secret exchange to sign.
