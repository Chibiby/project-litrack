// eslint-disable-next-line litrack/api-route-auth-check -- reads only the caller's own session (getAuthSession); returns no data, just renews the caller's cookie.
import { hasAuthSessionCookie } from "@/lib/auth/auth-cookies";
import { getAuthSession } from "@/lib/auth/auth-session";

/**
 * Renews the Better Auth signed session cache (`session_data` cookie).
 *
 * RSC renders cannot write cookies and better-auth's `nextCookies` plugin skips
 * the refresh for them, so after the cache expires every page render would read
 * the session row. A Route Handler can write cookies: `fresh: true` sets
 * `disableCookieCache`, Better Auth reads the row and re-issues the cookie
 * (better-auth session.mjs: `findSession` then `setCookieCache`), and
 * `nextCookies` copies that Set-Cookie onto this response. The browser calls
 * this every `SESSION_REFRESH_INTERVAL_MS`.
 *
 * Not a catch-all Better Auth handler (invariant I6): it makes one fixed
 * `auth.api.getSession` call. No audit row (not a security event) and no rate
 * limiter: it needs a valid session cookie and costs one indexed row read.
 * This path is under /api, which middleware skips, so it does not stamp the
 * read-your-writes cookie.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function cookieNames(request: Request): string[] {
  const header = request.headers.get("cookie") ?? "";
  return header
    .split(";")
    .map((part) => part.split("=")[0]?.trim() ?? "")
    .filter(Boolean);
}

export async function POST(request: Request): Promise<Response> {
  try {
    if (!hasAuthSessionCookie(cookieNames(request))) {
      return new Response(null, { status: 204, headers: NO_STORE });
    }
    const session = await getAuthSession({ fresh: true });
    return new Response(null, { status: session ? 204 : 401, headers: NO_STORE });
  } catch (error) {
    console.error("[session-refresh] failed:", error instanceof Error ? error.name : "unknown");
    return new Response(null, { status: 503, headers: NO_STORE });
  }
}
