import "server-only";

/**
 * Verify a LIFF ID token with LINE and return the verified user.
 * Never trust a userId sent by the browser; only trust `sub` from this call.
 * https://developers.line.biz/en/reference/line-login/#verify-id-token
 */
export type LineUser = { userId: string; displayName: string };

export async function verifyLineIdToken(idToken: string): Promise<LineUser | null> {
  const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!clientId) throw new Error("LINE_LOGIN_CHANNEL_ID is not set");

  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
    cache: "no-store",
  });
  if (!res.ok) return null; // expired, wrong channel, or forged

  const data = (await res.json()) as { sub?: string; name?: string };
  if (!data.sub) return null;
  return { userId: data.sub, displayName: data.name ?? "" };
}
