import "server-only";
import { JWT } from "google-auth-library";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Registration } from "./schema";
import { devBrowserTest } from "./devMode";

/** Browser test mode without Google configured: store rows in a local JSONL file. */
const useLocalFile = () => devBrowserTest && !process.env.SHEET_ID;
const LOCAL_FILE = path.join(process.cwd(), "dev-data", "registrations.jsonl");

async function readLocal(): Promise<string[][]> {
  try {
    const txt = await fs.readFile(LOCAL_FILE, "utf8");
    return txt.split("\n").filter(Boolean).map((l) => JSON.parse(l) as string[]);
  } catch {
    return [];
  }
}

/**
 * Column order of the Registrations tab. Row 1 of the sheet must contain these
 * headers in this order (see README). apps-script/notify.gs relies on the same order.
 */
export const COLUMNS = [
  "request_no",       // A
  "submitted_at",     // B  ISO time, Asia/Bangkok
  "status",           // C  pending | approved | rejected  (admin edits this)
  "line_user_id",     // D  verified by LINE, never typed by the user
  "line_display_name",// E
  "company",          // F
  "name_th",          // G
  "name_en",          // H
  "phone",            // I
  "email",            // J
  "role",             // K
  "package",          // L
  "consent_version",  // M
  "consented_at",     // N
  "lang",             // O
  "admin_note",       // P  admin fills in; sent to the user on rejection
  "decided_at",       // Q  set by notify.gs
  "notified_at",      // R  set by notify.gs
] as const;

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

function client() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("Google service account env vars are not set");
  return new JWT({ email, key, scopes: SCOPES });
}

function sheetCfg() {
  const id = process.env.SHEET_ID;
  if (!id) throw new Error("SHEET_ID is not set");
  const tab = process.env.SHEET_TAB || "Registrations";
  return { id, tab: `'${tab.replace(/'/g, "''")}'` };
}

const base = "https://sheets.googleapis.com/v4/spreadsheets";

/** Return the request number of a pending row for this LINE user, if any. */
export async function findPending(lineUserId: string): Promise<string | null> {
  if (useLocalFile()) {
    const hit = (await readLocal()).find((r) => r[3] === lineUserId && r[2] === "pending");
    return hit?.[0] ?? null;
  }
  const { id, tab } = sheetCfg();
  const range = encodeURIComponent(`${tab}!A2:D`);
  const res = await client().request<{ values?: string[][] }>({
    url: `${base}/${id}/values/${range}`,
  });
  for (const row of res.data.values ?? []) {
    if (row[3] === lineUserId && (row[2] ?? "").toLowerCase() === "pending") return row[0] ?? null;
  }
  return null;
}

/** Bangkok-local ISO timestamp, e.g. 2026-09-28T02:17:00+07:00 */
export function bangkokNow(d = new Date()): string {
  const t = new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 19);
  return `${t}+07:00`;
}

export async function appendRegistration(args: {
  requestNo: string;
  lineUserId: string;
  lineDisplayName: string;
  data: Registration;
  consentVersion: string;
}) {
  const now = bangkokNow();
  const { data } = args;

  const row = [
    args.requestNo,
    now,
    "pending",
    args.lineUserId,
    args.lineDisplayName,
    data.company,
    data.nameTh,
    data.nameEn,
    data.phone,
    data.email,
    data.role,
    data.pkg,
    args.consentVersion,
    now,
    data.lang,
    "",
    "",
    "",
  ];

  if (useLocalFile()) {
    await fs.mkdir(path.dirname(LOCAL_FILE), { recursive: true });
    await fs.appendFile(LOCAL_FILE, JSON.stringify(row) + "\n", "utf8");
    console.log(`[browser test] saved ${args.requestNo} to dev-data/registrations.jsonl`);
    return;
  }

  // valueInputOption=RAW stores every value as literal text:
  // "=IMPORTXML(...)" stays a string (no formula injection) and "0812345678" keeps its leading zero.
  const { id, tab } = sheetCfg();
  const range = encodeURIComponent(`${tab}!A:R`);
  await client().request({
    url: `${base}/${id}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    method: "POST",
    data: { values: [row] },
  });
}
