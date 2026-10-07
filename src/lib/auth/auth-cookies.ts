/**
 * Better Auth cookies as the Edge middleware sees them.
 *
 * Edge-safe by rule (invariant I8): no Prisma, no `server-only`, nothing that
 * opens a connection. Only `better-auth/cookies` (pure cookie parsing plus an
 * HMAC check) and the pure role parser.
 *
 * Middleware is not authoritative. It reads the role from the HMAC-verified
 * compact cookie cache, which lives at most `cookieCache.maxAge` (5 minutes)
 * after the last server-side session read. When it has expired the role is
 * null and the request passes through — the same "legacy role-less" path
 * Supabase sessions without `app_metadata.role` took — and `requireUser`,
 * which re-reads the `User` row every request, decides.
 */

import { getCookieCache, getSessionCookie } from "better-auth/cookies";
import { parseAppMetadataRole, type AppRole } from "@/lib/auth/roles";

/** `advanced.cookiePrefix` in the Better Auth config. Cookies are `litrack.<name>`. */
export const AUTH_COOKIE_PREFIX = "litrack";

/** `session.cookieCache.version` in the Better Auth config; both sides must agree. */
export const AUTH_COOKIE_CACHE_VERSION = "1";

const SECURE_PREFIX = "__Secure-";

/**
 * Whether auth cookies carry the `__Secure-` prefix and `Secure` flag. The one
 * place that decides it: the Better Auth config (`advanced.useSecureCookies`)
 * and the middleware both call this, because a disagreement means middleware
 * looks for the wrong cookie name and silently never sees a role (risk R7).
 *
 * Inlined at build time for `NEXT_PUBLIC_*`, so the Edge bundle and the server
 * bundle read the same value.
 */
export function authCookiesSecure(): boolean {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().toLowerCase().startsWith("https");
}

/** Full cookie name as written, e.g. `__Secure-litrack.session_token`. */
export function authCookieName(name: string): string {
  return `${authCookiesSecure() ? SECURE_PREFIX : ""}${AUTH_COOKIE_PREFIX}.${name}`;
}

/** The signed session token cookie, with or without the secure prefix. */
const SESSION_TOKEN_COOKIE = new RegExp(
  `^(?:${SECURE_PREFIX})?${AUTH_COOKIE_PREFIX}\\.session_token$`
);

/** `sb-<project>-auth-token`, whole or chunked — not the PKCE verifier cookie. */
const LEGACY_SUPABASE_SESSION_COOKIE = /^sb-.+-auth-token(?:\.\d+)?$/;

/** Any leftover Supabase cookie (session chunks, PKCE verifier) worth expiring. */
const LEGACY_SUPABASE_COOKIE = /^sb-.+-auth-token(?:[.-].+)?$/;

export function hasAuthSessionCookie(names: Iterable<string>): boolean {
  for (const name of names) if (SESSION_TOKEN_COOKIE.test(name)) return true;
  return false;
}

/**
 * A Supabase session cookie from before the move. Counts as "had a session" so
 * the forced sign-out after cutover says `?reason=session_expired` instead of
 * a bare login page.
 */
export function hasLegacySupabaseCookie(names: Iterable<string>): boolean {
  for (const name of names) if (LEGACY_SUPABASE_SESSION_COOKIE.test(name)) return true;
  return false;
}

/** Names of every leftover `sb-*-auth-token*` cookie, for the middleware to expire. */
export function legacySupabaseCookieNames(names: Iterable<string>): string[] {
  const out: string[] = [];
  for (const name of names) if (LEGACY_SUPABASE_COOKIE.test(name)) out.push(name);
  return out;
}

export type EdgeSessionUser = {
  /** `AuthUser.id` (= `User.authId`) from the verified cookie cache, or null when it expired. */
  id: string | null;
  /** Role mirrored on `AuthUser.role`, or null when the cache expired or holds no known role. */
  role: AppRole | null;
};

/**
 * The signed-in user as far as the Edge can tell without a database: null
 * when there is no session token cookie at all, otherwise whatever the
 * HMAC-verified cookie cache says (both fields null once it has expired, or
 * when the secret is missing or the cookie fails verification).
 *
 * Never throws. A missing `BETTER_AUTH_SECRET` makes `getCookieCache` throw;
 * that degrades to "role unknown", which only switches off the
 * defense-in-depth prefix check (`requireUser` still protects every page).
 */
export async function readEdgeSession(request: Request | Headers): Promise<EdgeSessionUser | null> {
  const token = getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX });
  if (!token) return null;

  let cached: Awaited<ReturnType<typeof getCookieCache>> = null;
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret) {
    try {
      cached = await getCookieCache(request, {
        cookiePrefix: AUTH_COOKIE_PREFIX,
        secret,
        strategy: "compact",
        isSecure: authCookiesSecure(),
        version: AUTH_COOKIE_CACHE_VERSION,
      });
    } catch {
      cached = null;
    }
  }

  const user = cached?.user as { id?: unknown; role?: unknown } | undefined;
  return {
    id: typeof user?.id === "string" && user.id.length > 0 ? user.id : null,
    role: parseAppMetadataRole(user?.role),
  };
}
