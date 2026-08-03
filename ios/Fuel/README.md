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
| App ID `com.labloggercompany.fuel` with **HealthKit** + **Sign in with Apple** | Apple Developer portal | ✅ already registered |
| `GOOGLE_IOS_CLIENT_ID` | Vercel env | Google sign-in, app |
| `GoogleClientID` + reversed URL scheme | `ios/Fuel/project.yml` | Google sign-in, app |
| `APPLE_SERVICE_ID` | Vercel env | Sign in with Apple, **web only** |

**Sign in with Apple in the app works already** — it needs only the capability, which is
registered. Build with your team and it will run.

**Google in the app** needs an iOS OAuth client. It must be created in the Google Cloud
project that owns Fuel's existing web client (project number `804091048275` — the prefix
of `GOOGLE_CLIENT_ID`):

1. Google Cloud console → APIs & Services → Credentials → **Create credentials → OAuth
   client ID → iOS**.
2. Bundle ID: `com.labloggercompany.fuel`.
3. Copy the client ID, then:
   ```bash
   vercel env add GOOGLE_IOS_CLIENT_ID production   # paste the client ID
   ```
4. In `ios/Fuel/project.yml`, replace both `REPLACE_WITH_IOS_CLIENT_ID` placeholders —
   the `GoogleClientID` value, and the reversed form in `CFBundleURLSchemes`
   (`com.googleusercontent.apps.<the numeric part>`). Then `xcodegen generate`.

Until that is done the app says so and points at Sign in with Apple, rather than failing
silently.

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
