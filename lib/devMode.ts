import "server-only";
import { randomBytes } from "node:crypto";

/**
 * Browser test mode for local development.
 *
 * Active only when BOTH are true:
 *   - NODE_ENV !== "production"  (i.e. `npm run dev`; Vercel and `next start` are always production)
 *   - DEV_BROWSER_TEST=1 in .env.local
 *
 * In test mode:
 *   - the page works in any browser at /?preview=1 (no LINE app, no LINE account)
 *   - the server accepts the fake "preview-token" and invents a user id "TEST-xxxxxxxx"
 *   - Turnstile is skipped if TURNSTILE_SECRET_KEY is empty
 *   - if SHEET_ID is empty, rows go to ./dev-data/registrations.jsonl instead of Google Sheets
 */
export const devBrowserTest =
  process.env.NODE_ENV !== "production" && process.env.DEV_BROWSER_TEST === "1";

export const PREVIEW_TOKEN = "preview-token";

export function fakeTestUser() {
  return { userId: `TEST-${randomBytes(4).toString("hex")}`, displayName: "Browser test" };
}
