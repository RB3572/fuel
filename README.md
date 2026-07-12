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
```

`SESSION_SECRET` should be a high-entropy random string. `TOKEN_ENCRYPTION_KEY` should be a 32-byte base64 or 64-character hex value. Never commit `.env.local`, credential JSON, access tokens, refresh tokens, or client secrets.

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
- Sign out clears the local session cookie.
- Disconnect revokes the Google token and clears the local session cookie.
- The frontend never receives Google credentials, authorization codes, access tokens, refresh tokens, client secrets, or credential JSON.
