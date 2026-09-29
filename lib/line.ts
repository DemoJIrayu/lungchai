import "server-only";

/**
 * Verify a LIFF ID token with LINE and return the verified user.
 * Never trust a userId sent by the browser; only trust `sub` from this call.
 * https://developers.line.biz/en/reference/line-login/#verify-id-token
 */
export type LineUser = { userId: string; displayName: string };

/**
 * The LINE Login channel that owns the LIFF app.
 * A LIFF ID looks like "<channelId>-<random>", so the channel ID can be read from it.
 * LINE_LOGIN_CHANNEL_ID is optional; if set, it must match that prefix.
 */
export function lineChannel() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID ?? "";
  const fromLiff = /^(\d+)-/.exec(liffId)?.[1] ?? "";
  const fromEnv = (process.env.LINE_LOGIN_CHANNEL_ID ?? "").trim();
  return {
    channelId: fromEnv || fromLiff,
    fromEnv,
    fromLiff,
    mismatch: !!fromEnv && !!fromLiff && fromEnv !== fromLiff,
  };
}

let warned = false;

export type VerifyResult =
  | { ok: true; user: LineUser }
  | { ok: false; reason: string };

export async function verifyLineIdToken(idToken: string): Promise<VerifyResult> {
  const ch = lineChannel();
  if (!ch.channelId) return { ok: false, reason: "no channel id (set NEXT_PUBLIC_LIFF_ID or LINE_LOGIN_CHANNEL_ID)" };
  if (ch.mismatch && !warned) {
    warned = true;
    console.warn(
      `LINE_LOGIN_CHANNEL_ID (${ch.fromEnv}) does not match the channel in NEXT_PUBLIC_LIFF_ID (${ch.fromLiff}). ` +
        "Every token check will fail. Use the LINE Login channel ID, not the Messaging API one.",
    );
  }

  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: ch.channelId }),
    cache: "no-store",
  });

  if (!res.ok) {
    // LINE explains why, e.g. "IdToken expired." or "Invalid IdToken Audience."
    const body = (await res.json().catch(() => ({}))) as { error_description?: string; error?: string };
    return { ok: false, reason: `LINE verify ${res.status}: ${body.error_description || body.error || "unknown"}` };
  }

  const data = (await res.json()) as { sub?: string; name?: string };
  if (!data.sub) return { ok: false, reason: "LINE verify returned no user id" };
  return { ok: true, user: { userId: data.sub, displayName: data.name ?? "" } };
}
