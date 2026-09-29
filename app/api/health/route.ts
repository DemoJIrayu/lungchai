import { NextResponse } from "next/server";
import { lineChannel } from "@/lib/line";
import { getCompanies } from "@/lib/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Setup check for the deployed server. Shows which settings are present
 * (never their values) and whether Companies_DB can be read.
 * Open https://<your-domain>/api/health in a browser.
 */
export async function GET(req: Request) {
  const has = (k: string) => !!process.env[k]?.trim();
  const ch = lineChannel();

  let companies: string;
  try {
    const list = await getCompanies();
    companies = list.length ? "ok" : "ok, but Companies_DB has no rows with both Company_Name and Company_ID";
  } catch (e) {
    companies = "error: " + (e instanceof Error ? e.message : String(e));
  }

  const problems: string[] = [];
  if (!has("NEXT_PUBLIC_LIFF_ID")) problems.push("NEXT_PUBLIC_LIFF_ID is not set on the server (it must also be set BEFORE `npm run build`)");
  if (ch.mismatch) problems.push(`LINE_LOGIN_CHANNEL_ID (${ch.fromEnv}) ≠ channel in LIFF ID (${ch.fromLiff}). Use the LINE Login channel ID, or delete LINE_LOGIN_CHANNEL_ID.`);
  if (!has("GOOGLE_SERVICE_ACCOUNT_EMAIL") || !has("GOOGLE_PRIVATE_KEY")) problems.push("Google service account variables are missing");
  if (!has("SHEET_ID")) problems.push("SHEET_ID is missing");
  if (!has("TURNSTILE_SECRET_KEY")) problems.push("TURNSTILE_SECRET_KEY is missing (registration will fail)");
  if (companies.startsWith("error")) problems.push("Cannot read Companies_DB: " + companies.slice(7));

  return NextResponse.json(
    {
      ok: problems.length === 0,
      problems,
      line: {
        liffId: has("NEXT_PUBLIC_LIFF_ID"),
        channelIdUsed: ch.channelId || null,
        channelIdSource: ch.fromEnv ? "LINE_LOGIN_CHANNEL_ID" : ch.fromLiff ? "from NEXT_PUBLIC_LIFF_ID" : "none",
      },
      google: {
        serviceAccountEmail: has("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
        privateKey: has("GOOGLE_PRIVATE_KEY"),
        sheetId: has("SHEET_ID"),
        companiesDb: companies,
      },
      turnstileSecret: has("TURNSTILE_SECRET_KEY"),
      // Send any "Authorization: Bearer x" header to this URL to see if your host passes it through.
      authorizationHeaderReceived: req.headers.has("authorization"),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
