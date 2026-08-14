# Fuel

A personal nutrition and fitness dashboard. One person's food log, Apple Health data,
blood results, body measurements and workouts, in one place, with an AI coach that runs
on the phone.

**Fuel is an iOS app.** The website at `fuel.rishib.com` still runs and still serves the
API the app depends on, but the web dashboard itself is **legacy and no longer
maintained** — see [Repository layout](#repository-layout).

- **[`ios/Fuel/README.md`](ios/Fuel/README.md)** — the app: building, signing in, shipping.
- **[`HEALTH_SYNC.md`](HEALTH_SYNC.md)** — how Apple Health data gets in.
- **[`HANDOFF.md`](HANDOFF.md)** — how the codebase actually works, and every trap in it.
  Read this before making changes.

## What it does

- **Logging opens the camera.** Photograph a meal; it is identified, estimated and
  logged. Typing, a searchable library of past foods, and saved meals are all one tap
  away.
- **Apple Health, summarised.** Around fifty metrics a day — energy, heart, sleep
  stages, respiratory, body, environmental, mobility — read directly from HealthKit,
  with logged food optionally written back.
- **A coach that runs on device.** Nutrition estimates, photo identification and chat
  use Apple's `FoundationModels`. No key, no quota, no round trip; food photos never
  leave the phone. Bring your own Claude, OpenAI or Gemini key instead if you prefer.
- **Trends, comparisons and context.** Charts for everything, each vital graded against
  published reference ranges for your age and sex rather than against a bare average.
- **Blood panels.** Paste a lab report; it is parsed, stored, and each marker plotted on
  its own reference range.
- **Journeys.** Lifetime distance rendered as recognisable routes — Alcatraz crossings,
  the Great Wall, the length of the Nile — and a spinnable globe showing your progress
  around one lap of the planet.
- **Home Screen widgets.** Sixteen of them, plus Lock Screen and Control Center
  controls, themed from your palette.

## Repository layout

| Path | What | State |
|---|---|---|
| `ios/Fuel` | The iOS app | **Active** — this is the product |
| `ios/FuelWidgets` | Home Screen / Lock Screen widgets | Active, ships in the app |
| `ios/HealthLogger` | Standalone HealthKit bridge | Vestigial — but Fuel shares six of its source files by path, so its sync code is live. See `HANDOFF.md` §5.2 |
| `api/` | Vercel serverless API over Neon Postgres | **Active** — the app's backend |
| `test/` | Test suite (`npm test`) | Active |
| `src/`, `public/` | React + vanilla-JS web dashboard | **Legacy, unmaintained** |

The web dashboard predates the app and has not kept up with it — it knows nothing about
blood panels, journeys, body measurements, the sleep card or the newer Health metrics.
It is left running because it costs nothing to leave running. Do not spend effort on it
unless asked.

## Data

Neon Postgres, via `@neondatabase/serverless`, is the only store. An earlier design used
a Google Sheet as the database; every path back to it has been removed.

All server routes dispatch through `api/mlog.js` on a `?fuel_route=<name>` query
parameter. Some public paths are rewritten to it in `vercel.json`; the iOS app mostly
calls it directly.

## Development

```sh
npm install
npm test              # the whole suite, ~1s
npm run dev           # the legacy web dashboard, if you need it
```

For the app, see [`ios/Fuel/README.md`](ios/Fuel/README.md).

Server deploys:

```sh
npx vercel deploy --prod --yes
```

## Environment

Set in Vercel Project Settings for production, `.env.local` for local work. Never
prefixed with `VITE_` — none of these may reach the browser.

```sh
NEW_FUEL_DATABASE_URL=         # Neon Postgres. Note the name — there is deliberately
                               # no fallback to DATABASE_URL, because a fallback is how
                               # an app silently finds a database nobody meant it to use
SESSION_SECRET=                # high-entropy random string
TOKEN_ENCRYPTION_KEY=          # 32-byte base64 or 64-char hex

# Sign-in
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://fuel.rishib.com/api/auth/google/callback
GOOGLE_IOS_CLIENT_ID=          # native iOS OAuth client (public by design, PKCE)
APPLE_SERVICE_ID=              # Sign in with Apple, web flow only
APPLE_BUNDLE_ID=
APP_URL=https://fuel.rishib.com

# AI (server-side, legacy web only — the app's AI is on-device or BYOK)
GEMINI_API_KEY=                # or GOOGLE_API_KEY
GEMINI_MODEL=                  # optional; overrides the fallback chain wholesale.
                               # Per-feature overrides: GEMINI_MEAL_PLAN_MODEL,
                               # GEMINI_FOOD_MODEL, GEMINI_QUICKLOG_MODEL,
                               # GEMINI_RECIPE_MODEL
```

The `HEALTH_IMPORT_TOKEN`, `MLOG_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_JSON` and
`GOOGLE_REFRESH_TOKEN` variables belong to the retired Google Sheets importer. They are
still referenced by dead legacy routes and are not needed.

Never commit `.env.local`, credential JSON, tokens or client secrets.

## Production

Vercel, at `fuel.rishib.com`, with a DNS-only CNAME to `cname.vercel-dns.com`. Redeploy
after changing environment variables.

## Security notes

- Google tokens are encrypted with `TOKEN_ENCRYPTION_KEY` and stored only in HTTP-only
  session cookies; OAuth state is validated against an HTTP-only cookie.
- The iOS app embeds no client secret. Native sign-in posts the provider's ID token to
  `/api/auth/native`, which verifies it against the provider's JWKS — tested against
  forged, tampered, expired and downgraded tokens in `test/native-auth.test.js`.
- The Health sync endpoint authenticates with a bearer token minted in-app, verified in
  constant time.
- The frontend and the app never receive Google credentials, authorization codes,
  refresh tokens or client secrets.
