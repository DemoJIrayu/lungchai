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
  "company_id",       // F  from Companies_DB, checked by the server
  "company_name",     // G  looked up by the server from company_id
  "name_th",          // H
  "name_en",          // I
  "phone",            // J
  "email",            // K
  "role",             // L
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

const quoteTab = (tab: string) => `'${tab.replace(/'/g, "''")}'`;
function sheetCfg() {
  const id = process.env.SHEET_ID;
  if (!id) throw new Error("SHEET_ID is not set");
  return { id, tab: quoteTab(process.env.SHEET_TAB || "Registrations") };
}

const base = "https://sheets.googleapis.com/v4/spreadsheets";

// ---------------------------------------------------------------------------
// Companies_DB
// ---------------------------------------------------------------------------

export type Company = { id: string; name: string };

/** Sample list for browser test mode when no sheet is configured. */
const SAMPLE_COMPANIES: Company[] = [
  { id: "C001", name: "?????? ?????? ????? ?????" },
  { id: "C002", name: "?????? ????? ?????????? ?????" },
  { id: "C003", name: "Sample Fleet Co., Ltd." },
];

const CACHE_MS = 5 * 60_000;
let cache: { at: number; list: Company[] } | null = null;

/**
 * Read Company_Name / Company_ID from the Companies_DB tab.
 * Columns are found by header name, so their position in the sheet doesn't matter.
 * Cached for 5 minutes per server instance; new companies appear within that time.
 */
export async function getCompanies(): Promise<Company[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.list;

  const id = process.env.COMPANIES_SHEET_ID || process.env.SHEET_ID;
  if (!id && devBrowserTest) return SAMPLE_COMPANIES;
  if (!id) throw new Error("SHEET_ID is not set");

  const tab = quoteTab(process.env.COMPANIES_TAB || "Companies_DB");
  const range = encodeURIComponent(`${tab}!A:Z`);
  const res = await client().request<{ values?: string[][] }>({
    url: `${base}/${id}/values/${range}?valueRenderOption=FORMATTED_VALUE`,
  });

  const [header = [], ...rows] = res.data.values ?? [];
  const norm = (s: string) => s.trim().toLowerCase();
  const iName = header.findIndex((h) => norm(h) === "company_name");
  const iId = header.findIndex((h) => norm(h) === "company_id");
  if (iName < 0 || iId < 0) {
    throw new Error("Companies_DB must have Company_Name and Company_ID headers in row 1");
  }

  const seen = new Set<string>();
  const list: Company[] = [];
  for (const r of rows) {
    const cid = String(r[iId] ?? "").trim();
    const name = String(r[iName] ?? "").trim();
    if (!cid || !name || seen.has(cid)) continue;
    seen.add(cid);
    list.push({ id: cid, name });
  }
  list.sort((a, b) => a.name.localeCompare(b.name, "th"));

  cache = { at: Date.now(), list };
  return list;
}

export async function findCompany(companyId: string): Promise<Company | null> {
  return (await getCompanies()).find((c) => c.id === companyId) ?? null;
}

// ---------------------------------------------------------------------------
// Registrations
// ---------------------------------------------------------------------------

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
  company: Company;
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
    args.company.id,
    args.company.name,
    data.nameTh,
    data.nameEn,
    data.phone,
    data.email,
    data.role,
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
