# Fuel

Fuel is a personal athlete dashboard backed by one Google Sheet named `MLog` in the signed-in user's Google Drive root directory. The browser talks only to Vercel API routes; Google OAuth credentials, authorization codes, access tokens, refresh tokens, and token encryption keys must stay server-side.

## Data Source

`MLog` is the sole source of truth. On first sign-in, the app searches Drive root for a Google spreadsheet named `MLog`. If it is absent, the server creates it. If it already exists, the server preserves existing rows and only adds missing tabs or missing header columns.

Required tabs:

- `Food Log`
- `Daily Summary`
- `Recipes`
- `Workout Activity`
- `Energy Balance`
- `Recovery`
- `Goals`
- `Dashboard`

Blank or missing cells render as `Not logged`; they are not treated as zero.

## Environment Variables

Set these in `.env.local` for local development and in Vercel Project Settings for production. Do not prefix them with `VITE_`.

```sh
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://fuel.rishib.com/api/auth/google/callback
APP_URL=https://fuel.rishib.com
SESSION_SECRET=
TOKEN_ENCRYPTION_KEY=

# Automated Health.md imports
HEALTH_IMPORT_TOKEN=
MLOG_SPREADSHEET_ID=
GOOGLE_SERVICE_ACCOUNT_JSON=
# Alternative to GOOGLE_SERVICE_ACCOUNT_JSON:
GOOGLE_REFRESH_TOKEN=
```

`SESSION_SECRET` should be a high-entropy random string. `TOKEN_ENCRYPTION_KEY` should be a 32-byte base64 or 64-character hex value. `HEALTH_IMPORT_TOKEN` should be a separate high-entropy random string used only by Health.md. Never commit `.env.local`, credential JSON, access tokens, refresh tokens, or client secrets.

## Google OAuth Setup

In the Google Cloud OAuth client, add this authorized redirect URI:

```text
https://fuel.rishib.com/api/auth/google/callback
```

For local auth testing, add a local callback and temporarily set `GOOGLE_REDIRECT_URI` to match it while running through `vercel dev`.

The app requests:

- `openid`
- `email`
- `profile`
- Google Drive metadata read access to find `MLog`
- Google Sheets access to read, create, and repair workbook structure

## Automated Apple Health Import

Fuel exposes a private ingestion route for Health.md:

```text
POST https://fuel.rishib.com/api/health/import
Authorization: Bearer <HEALTH_IMPORT_TOKEN>
Content-Type: application/json
```

The importer accepts an envelope containing one or more daily records, normalizes common Apple Health field names, and upserts the following MLog tabs by date:

- `Health Daily`
- `Recovery`
- `Energy Balance`

Existing manually entered calories, protein, scores, and notes in `Energy Balance` are preserved when the incoming health payload does not provide replacements. Current-day records are marked partial, and net energy balance remains blank until a completed day is available.

For unattended writes, configure one of these server-side credential methods:

1. `GOOGLE_SERVICE_ACCOUNT_JSON` (recommended). Share MLog with the service account's `client_email` as an editor.
2. `GOOGLE_REFRESH_TOKEN`, together with `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

Also set `MLOG_SPREADSHEET_ID` to the ID between `/d/` and `/edit` in the MLog URL. Enter the exact `HEALTH_IMPORT_TOKEN` value into Health.md's optional bearer-token field. The token must never be placed in frontend code or committed to GitHub.

The endpoint intentionally returns `503` until the token, spreadsheet ID, and one unattended Google credential method are configured.

## Development

```sh
npm install
npm run dev
npm run build
```

Use `vercel dev` when testing the `/api` routes locally.

## Production

Production runs on Vercel at `fuel.rishib.com`. The domain should point to Vercel with a DNS-only CNAME:

```text
fuel -> cname.vercel-dns.com
```

The Vercel project must have the environment variables above configured for Production. Redeploy after changing environment variables.

## Security Notes

- OAuth state is validated with an HTTP-only cookie.
- Google tokens are encrypted with `TOKEN_ENCRYPTION_KEY` and stored only in HTTP-only session storage.
- The Health.md importer requires a constant-time-verified bearer token.
- The importer does not log incoming health payload values.
- Sign out clears the local session cookie.
- Disconnect revokes the Google token and clears the local session cookie.
- The frontend never receives Google credentials, authorization codes, access tokens, refresh tokens, client secrets, or credential JSON.
