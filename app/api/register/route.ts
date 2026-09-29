import { NextResponse } from "next/server";
import { requestSchema, fieldErrors } from "@/lib/schema";
import { verifyTurnstile } from "@/lib/turnstile";
import { appendRegistration, findCompany, findPending } from "@/lib/sheets";
import { newRequestNo } from "@/lib/requestNo";
import { resolveUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ErrBody =
  | { error: "invalid"; fields: Record<string, string> }
  | { error: "line_auth" | "captcha" | "duplicate" | "server"; requestNo?: string };

function fail(status: number, body: ErrBody) {
  return NextResponse.json(body, { status });
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return fail(400, { error: "invalid", fields: {} });
  }

  // 1. Same validation as the browser; this is the one that counts.
  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return fail(422, { error: "invalid", fields: fieldErrors(parsed.error) });
  }
  const { idToken, turnstileToken, ...data } = parsed.data;

  try {
    // 2. Who is this? Verified by LINE, not by the browser.
    //    Browser test mode (local dev only) gives a fake TEST- user.
    const who = await resolveUser(idToken, "register");
    if (!who) return fail(401, { error: "line_auth" });

    // 3. Human check. Browser test mode may skip it when no secret is configured.
    const skipCaptcha = who.testing && !process.env.TURNSTILE_SECRET_KEY;
    if (!skipCaptcha) {
      const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
      if (!(await verifyTurnstile(turnstileToken, ip))) {
        return fail(403, { error: "captcha" });
      }
    }

    // 4. The company must exist in Companies_DB. The name is taken from the sheet,
    //    never from the browser.
    const company = await findCompany(data.companyId);
    if (!company) return fail(422, { error: "invalid", fields: { companyId: "company" } });

    // 5. One open request per LINE user.
    const existing = await findPending(who.user.userId);
    if (existing) return fail(409, { error: "duplicate", requestNo: existing });

    // 6. Write.
    const requestNo = newRequestNo();
    await appendRegistration({
      requestNo,
      lineUserId: who.user.userId,
      lineDisplayName: who.user.displayName,
      company,
      data,
      consentVersion: process.env.CONSENT_VERSION || "pdpa-v1",
    });

    return NextResponse.json({ ok: true, requestNo, companyName: company.name });
  } catch (e) {
    // Log without the submitted personal data.
    console.error("register failed:", e instanceof Error ? e.message : e);
    return fail(500, { error: "server" });
  }
}
