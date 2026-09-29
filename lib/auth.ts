import "server-only";
import { verifyLineIdToken, type LineUser } from "./line";
import { devBrowserTest, fakeTestUser, PREVIEW_TOKEN } from "./devMode";

/**
 * Resolve the caller from a LIFF ID token.
 * In browser test mode (local dev only) the fake preview token gives a TEST- user.
 */
export async function resolveUser(idToken: string | null | undefined): Promise<{ user: LineUser; testing: boolean } | null> {
  if (!idToken) return null;
  if (devBrowserTest && idToken === PREVIEW_TOKEN) return { user: fakeTestUser(), testing: true };
  const user = await verifyLineIdToken(idToken);
  return user ? { user, testing: false } : null;
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : null;
}
