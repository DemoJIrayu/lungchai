import { NextResponse } from "next/server";
import { bearer, resolveUser } from "@/lib/auth";
import { getCompanies } from "@/lib/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Company list for the dropdown.
 * Only for callers signed in through LINE (LIFF ID token in the Authorization header),
 * so the customer list isn't readable by anyone who finds this URL.
 */
export async function GET(req: Request) {
  try {
    const who = await resolveUser(bearer(req), "companies");
    if (!who) return NextResponse.json({ error: "line_auth" }, { status: 401 });

    const companies = await getCompanies();
    return NextResponse.json(
      { companies },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    console.error("companies failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "server" }, { status: 500 });
  }
}
