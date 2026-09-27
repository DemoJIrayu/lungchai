import { NextResponse } from "next/server";
import { requestSchema, fieldErrors } from "@/lib/schema";
import { verifyLineIdToken } from "@/lib/line";
import { verifyTurnstile } from "@/lib/turnstile";
import { appendRegistration, findPending } from "@/lib/sheets";
import { newRequestNo } from "@/lib/requestNo";

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
    // 2. Human check.
    const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (!(await verifyTurnstile(turnstileToken, ip))) {
      return fail(403, { error: "captcha" });
    }

    // 3. Who is this? Verified by LINE, not by the browser.
    const user = await verifyLineIdToken(idToken);
    if (!user) return fail(401, { error: "line_auth" });

    // 4. One open request per LINE user.
    const existing = await findPending(user.userId);
    if (existing) return fail(409, { error: "duplicate", requestNo: existing });

    // 5. Write.
    const requestNo = newRequestNo();
    await appendRegistration({
      requestNo,
      lineUserId: user.userId,
      lineDisplayName: user.displayName,
      data,
      consentVersion: process.env.CONSENT_VERSION || "pdpa-v1",
    });

    return NextResponse.json({ ok: true, requestNo });
  } catch (e) {
    // Log without the submitted personal data.
    console.error("register failed:", e instanceof Error ? e.message : e);
    return fail(500, { error: "server" });
  }
}
