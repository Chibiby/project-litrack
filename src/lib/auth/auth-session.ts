import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { getAuth, type LitrackAuth } from "@/lib/auth/better-auth";
import { prismaFresh } from "@/lib/prisma";
import { isAuthApiError, mapAuthError } from "@/lib/errors/auth-provider";
import type { ErrorCode } from "@/lib/errors/codes";

/**
 * The current Better Auth session, sign-in and sign-out — the server-side
 * replacement for `supabase.auth.{getClaims,signInWithPassword,signOut}`.
 *
 * Cookies: every call passes `await headers()`, and the `nextCookies` plugin
 * (last in the config) copies the Set-Cookie headers Better Auth produces onto
 * Next's cookie store. That works in Server Actions and Route Handlers; in a
 * Server Component render Next forbids cookie writes, and the plugin swallows
 * the write rather than throwing.
 */

export type AuthSessionData = NonNullable<
  Awaited<ReturnType<LitrackAuth["api"]["getSession"]>>
>;

const loadSession = cache(async (fresh: boolean): Promise<AuthSessionData | null> => {
  const session = await getAuth().api.getSession({
    headers: await headers(),
    // `fresh` skips the 15-minute signed cookie cache and reads the session row,
    // for checks that must see a revocation at once (impersonation proof,
    // sign-out scope). Ordinary page renders take the cache.
    query: { disableCookieCache: fresh },
  });
  return session ?? null;
});

/**
 * The session on this request, or null. Memoized per request and per
 * `fresh` flag with React `cache()`.
 *
 * `session.user.id` is the `AuthUser.id`, which is `User.authId`.
 * `session.session.impersonatedBy` is the admin's authId while a Super Admin
 * is signed in as someone else.
 *
 * Within one request, a read made before `signInWithPassword` /
 * `endCurrentSession` keeps returning what it saw; callers that sign in and
 * then need the new session in the same request use the sign-in result.
 */
export function getAuthSession(options?: { fresh?: boolean }): Promise<AuthSessionData | null> {
  return loadSession(Boolean(options?.fresh));
}

export type SignInResult =
  | { ok: true; authId: string }
  | {
      ok: false;
      /** `AUTH_INCORRECT_PASSWORD` for a wrong email or password. */
      code: ErrorCode;
      /** The provider's error, for `cause` and the admin record. Never shown. */
      error: unknown;
    };

/**
 * Better Auth `signInEmail`, which verifies the bcrypt hash and, through
 * `nextCookies`, sets the session cookies on the action's response.
 *
 * A refusal from Better Auth (wrong password, unknown email, banned) comes
 * back as `{ ok: false, code }` so the caller can audit the reason before
 * throwing, exactly as it did with Supabase's `{ error }`. Anything else — the
 * database being down above all — is thrown, so the `action()` wrapper
 * classifies it as the infrastructure failure it is.
 *
 * `rememberMe: true` gives a persistent 30-day cookie.
 */
export async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  try {
    const result = await getAuth().api.signInEmail({
      body: { email, password, rememberMe: true },
      headers: await headers(),
    });
    return { ok: true, authId: result.user.id };
  } catch (error) {
    if (!isAuthApiError(error)) throw error;
    return { ok: false, code: mapAuthError(error), error };
  }
}

/**
 * Sign this browser out: delete the current session row and expire the
 * session cookies. Best effort and never throws (it runs on teardown paths
 * that must keep going); returns whether Better Auth reported success.
 * Other devices stay signed in — pair with `revokeAllSessions` for a global
 * sign-out.
 */
export async function endCurrentSession(): Promise<boolean> {
  try {
    await getAuth().api.signOut({ headers: await headers() });
    return true;
  } catch (err) {
    console.error("[auth-session] endCurrentSession failed:", err);
    return false;
  }
}

/**
 * Delete every session of one identity, on every device. A plain database
 * delete, so it works from a Server Component render too (where cookie writes
 * are impossible). Signed cookie caches already issued stay readable for up
 * to 15 minutes (risk R4); `requireUser` re-reads the `User` row every
 * request, so deactivation is still immediate.
 *
 * Returns how many sessions were deleted.
 */
export async function revokeAllSessions(authId: string): Promise<number> {
  const { count } = await prismaFresh.authSession.deleteMany({ where: { userId: authId } });
  return count;
}

/**
 * Delete every session of one identity except the one holding `keepToken`
 * (the caller's own), as a self-service password change must: the person stays
 * signed in here while a stolen or forgotten device is signed out. When the
 * current token is unknown, nothing is kept.
 */
export async function revokeOtherSessions(authId: string, keepToken: string | null): Promise<number> {
  const { count } = await prismaFresh.authSession.deleteMany({
    where: keepToken ? { userId: authId, token: { not: keepToken } } : { userId: authId },
  });
  return count;
}
