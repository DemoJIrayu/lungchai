import "server-only";
import { verifyLineIdToken, type LineUser } from "./line";
import { devBrowserTest, fakeTestUser, PREVIEW_TOKEN } from "./devMode";

/**
 * Resolve the caller from a LIFF ID token.
 * In browser test mode (local dev only) the fake preview token gives a TEST- user.
 * On failure, logs why (never the token itself) so hosting logs show the real cause.
 */
export async function resolveUser(
  idToken: string | null | undefined,
  where: string,
): Promise<{ user: LineUser; testing: boolean } | null> {
  if (!idToken) {
    console.warn(
      `[${where}] 401: no LINE ID token in the request. ` +
        "Check that the LIFF app has the 'openid' scope, and that the host doesn't strip request headers.",
    );
    return null;
  }
  if (devBrowserTest && idToken === PREVIEW_TOKEN) return { user: fakeTestUser(), testing: true };

  const r = await verifyLineIdToken(idToken);
  if (!r.ok) {
    console.warn(`[${where}] 401: ${r.reason}`);
    return null;
  }
  return { user: r.user, testing: false };
}

/**
 * Read the token from the request.
 * Some shared hosts (Apache/LiteSpeed proxies) drop the Authorization header before it
 * reaches Node, so the page also sends it as X-Line-Id-Token.
 */
export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  if (h.startsWith("Bearer ")) return h.slice(7).trim() || null;
  return req.headers.get("x-line-id-token")?.trim() || null;
}
