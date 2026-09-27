# ลุงชัย Onboarding (first draft)

A registration form that opens from the LINE rich menu, validates on both the browser
and the server, and writes each application as one row in a Google Sheet. Admins approve
or reject in the Sheet, and the applicant is notified on LINE automatically.

```
LINE rich menu ──► LIFF page (Next.js on Vercel)
                     │  liff.getIDToken(), Turnstile token, form fields
                     ▼
                  POST /api/register
                     1. zod validation (same schema as the form)
                     2. Cloudflare Turnstile siteverify
                     3. LINE ID-token verify  → trusted userId
                     4. one pending request per LINE user
                     5. append row (valueInputOption=RAW) → Google Sheet
                                                              │
               admin sets status = approved / rejected ◄──────┘
                     │  (apps-script/notify.gs, onEdit trigger)
                     ▼
                  LINE push message to the applicant
```

## What changed from the mockup

| Mockup | Draft | Why |
|---|---|---|
| National ID | removed | you chose not to store it |
| Profile photo | removed | you chose not to store it |
| LINE ID text field | removed | LIFF gives the verified LINE user automatically |
| `@lungchai` | `@379iftpg` | your real OA |
| Opens anywhere | LINE only | outside LINE the page shows "open in LINE" + QR |
| Request no. made in browser | `LC-YYMMDD-XXXX` made on the server | unique, can't be forged |

The page also blocks the form until the user has added `@379iftpg` as a friend,
because otherwise the approval message can't be delivered.

## Project layout

```
app/page.tsx                 renders the form
app/api/register/route.ts    the only server endpoint
components/Onboarding.tsx    LIFF boot, friendship gate, form, success screen
components/Turnstile.tsx     Cloudflare Turnstile widget
lib/schema.ts                zod schema shared by client + server, roles, packages
lib/i18n.ts                  Thai / English text
lib/line.ts                  LINE ID-token verification
lib/turnstile.ts             Turnstile verification
lib/sheets.ts                Google Sheets append + duplicate check (column order lives here)
lib/requestNo.ts             request number generator
apps-script/notify.gs        paste into the Sheet: approval push + 1-year purge
```

## Setup

### 1. Google Sheet
1. Create a spreadsheet in your Workspace, owned by the system admin account.
2. Extensions → Apps Script → paste `apps-script/notify.gs`.
3. Project Settings → Script properties → add `LINE_CHANNEL_ACCESS_TOKEN`
   (LINE Developers → Messaging API channel of @379iftpg → long-lived channel access token).
4. Run `setup()` once. It creates the `Registrations` tab with headers, the status dropdown,
   a warning-only protection on system columns, and the two triggers.

### 2. Google service account (lets the website write rows)
1. Google Cloud Console → a project → enable **Google Sheets API**.
2. IAM → Service accounts → create one → Keys → add JSON key.
3. Share the spreadsheet with the service account email as **Editor**.

> The service account is a second identity with access to this Sheet, next to the admin
> account. Guard the JSON key: only put it in Vercel env vars, never in the repo.
> If your Workspace blocks sharing with outside addresses, a Workspace admin must allow
> sharing with `*.iam.gserviceaccount.com` (Admin console → Apps → Drive → Sharing settings).

### 3. Cloudflare Turnstile
Cloudflare dashboard → Turnstile → add a widget for your Vercel domain → copy the site key and secret.

### 4. LINE LIFF app
1. LINE Developers → the **same provider** as @379iftpg → create a **LINE Login** channel
   (or use an existing one) → LIFF tab → Add.
   - Size: **Full**
   - Endpoint URL: your deployed URL, e.g. `https://lungchai-onboarding.vercel.app`
   - Scopes: `openid`, `profile`
   - Add friend option: **On (normal)**
2. In the LINE Login channel → Basic settings → **Linked LINE Official Account** → select @379iftpg.
   (Needed for the friendship check.)
3. Copy the LIFF ID and the LINE Login channel ID.
4. Rich menu → the "Register" button action = Link → `https://liff.line.me/<LIFF_ID>`.

### 5. Deploy on Vercel
1. Push this folder to a Git repo and import it in Vercel.
2. Add every variable from `.env.example`. For `GOOGLE_PRIVATE_KEY`, paste the key exactly as
   in the JSON file (with `\n`).
3. Deploy, then put the production URL into the LIFF endpoint URL.

## Local development

```bash
cp .env.example .env.local   # fill in values
npm install
npm run dev
```

### Test in a normal browser, no LINE account needed

1. In `.env.local` set `DEV_BROWSER_TEST=1`. You can leave every other value empty.
2. `npm run dev`, then open **http://localhost:3000/?preview=1** in Chrome, Safari, etc.
3. Fill in the form and submit. A red TEST MODE banner shows you're in this mode.

What happens in test mode:

| Step | Normal | Test mode |
|---|---|---|
| Open outside LINE | blocked | allowed |
| Friend check | required | skipped |
| LINE identity | verified with LINE | fake user `TEST-xxxxxxxx` |
| Turnstile | required | skipped if `TURNSTILE_SECRET_KEY` is empty (or use Cloudflare's always-pass test keys from `.env.example`) |
| Where the row goes | Google Sheet | Google Sheet if `SHEET_ID` is set, otherwise `dev-data/registrations.jsonl` |
| Approval push (notify.gs) | LINE message | skipped; `notified_at` = `skipped (test)` |

Add `&lang=en` to the URL to test the English version.

Test mode cannot be switched on by accident in production: it needs **both**
`DEV_BROWSER_TEST=1` and a development server (`npm run dev`). Vercel and `next start` always
run in production mode and ignore the flag, so a fake token is rejected there.

If you test against the real Sheet, delete the `TEST-` rows afterwards.

### Test the real LINE flow

Use the deployed URL through the rich menu, or expose localhost with a tunnel and temporarily
point the LIFF endpoint URL at it.

## Admin workflow

1. New request arrives as `status = pending`.
2. Admin checks the details (and may call the phone number), optionally writes `admin_note`
   (e.g. login details, or the reason for rejection).
3. Admin sets `status` to `approved` or `rejected`.
   → the applicant receives a LINE message in the language they used; `decided_at` and
   `notified_at` are filled in. If `notified_at` stays empty, the push failed; check
   Apps Script → Executions.
4. Every day at 03:00 (Bangkok), rejected or still-pending rows older than 365 days are deleted.
   Approved rows are kept; they are the seed of the user database.

Tip: write `admin_note` first, then change `status`, because the message is sent the moment status changes.

## Security notes

- The browser never decides who the user is; the server verifies the LIFF ID token with LINE.
- Validation runs again on the server with the same zod schema.
- Rows are written with `valueInputOption=RAW`, so text like `=IMPORTXML(...)` is stored as
  text, not run as a formula, and phone numbers keep their leading zero.
- One pending request per LINE user; a second attempt returns the existing request number.
- Server logs never include the submitted personal data.

## Not in this draft

- A real privacy policy page (`NEXT_PUBLIC_PRIVACY_URL` is a placeholder).
- Rate limiting beyond Turnstile + LINE login (fine for 10–30 signups/month).
- Tests.
