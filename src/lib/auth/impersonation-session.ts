import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { getAuth } from "@/lib/auth/better-auth";
import { getAuthSession } from "@/lib/auth/auth-session";
import { authCookieName, authCookiesSecure } from "@/lib/auth/auth-cookies";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors/app-error";
import { isAuthApiError, mapAuthError } from "@/lib/errors/auth-provider";

/**
 * Super Admin "Sign in as", on Better Auth's admin plugin. Replaces the HMAC
 * ticket in `@/lib/auth/impersonation` (deleted by the removal lane).
 *
 * The proof is server-side: `impersonateUser` creates a session row with
 * `impersonatedBy = <admin authId>` and a 2-hour expiry, keeps the admin's own
 * session token in the signed `litrack.admin_session` cookie, and swaps the
 * session cookie — all in one response, so there is no window where the admin
 * has neither session. `stopImpersonating` deletes the impersonated row (so
 * the way back works once) and restores the admin's session. A later,
 * independent sign-in by the target is a new row without `impersonatedBy`, so
 * it can never be mistaken for the admin (invariant I7).
 *
 * LITRACK's own refusals (role allow-list, stranding guard, rate limit, the
 * admin re-query on the way back) stay in the actions that call this module.
 */

export const IMPERSONATION_RETURN_TO = ["test-lab"] as const;
export type ImpersonationReturnTo = (typeof IMPERSONATION_RETURN_TO)[number];

/**
 * Where "Return to admin" lands when the target's school does not decide it.
 * Not a credential (it grants nothing), only an allowlisted hint; anything
 * outside the allowlist reads as absent.
 */
const RETURN_COOKIE = "litrack_impersonation_return";

function isReturnTo(value: unknown): value is ImpersonationReturnTo {
  return (IMPERSONATION_RETURN_TO as readonly unknown[]).includes(value);
}

function providerFailure(err: unknown, operation: string): AppError {
  const code = mapAuthError(err);
  return new AppError(code === "AUTH_FORBIDDEN" ? "AUTH_FORBIDDEN" : code, {
    cause: err,
    params: code === "AUTH_FORBIDDEN" ? { what: "this account" } : undefined,
    context: { reason: `impersonation_${operation}_refused` },
  });
}

/**
 * Become `targetAuthId` (an `AuthUser.id` = `User.authId`). Must run in a
 * Server Action whose request carries the Super Admin's own session. Throws an
 * AppError for a refusal from Better Auth (`AUTH_FORBIDDEN` for an admin
 * target, `IDENTITY_NOT_FOUND` for a target with no identity).
 */
export async function startImpersonationSession(input: {
  targetAuthId: string;
  returnTo?: ImpersonationReturnTo;
}): Promise<void> {
  try {
    await getAuth().api.impersonateUser({
      body: { userId: input.targetAuthId },
      headers: await headers(),
    });
  } catch (err) {
    if (isAuthApiError(err)) throw providerFailure(err, "start");
    throw err;
  }

  const store = await cookies();
  if (input.returnTo) {
    store.set(RETURN_COOKIE, input.returnTo, {
      httpOnly: true,
      sameSite: "lax",
      secure: authCookiesSecure(),
      path: "/",
      maxAge: 2 * 60 * 60,
    });
  } else if (store.has(RETURN_COOKIE)) {
    store.delete(RETURN_COOKIE);
  }
}

/**
 * Put the admin's own session back and delete the impersonated one. Must run
 * in a Server Action. The caller has already re-checked that `impersonatedBy`
 * is still an active Super Admin (Better Auth does not). Throws an AppError
 * when Better Auth refuses (no impersonation, admin session gone).
 */
export async function stopImpersonationSession(): Promise<void> {
  try {
    await getAuth().api.stopImpersonating({ headers: await headers() });
  } catch (err) {
    if (isAuthApiError(err)) throw providerFailure(err, "stop");
    throw err;
  }
  await clearReturnCookie();
}

async function clearReturnCookie(): Promise<void> {
  const store = await cookies();
  if (store.has(RETURN_COOKIE)) store.delete(RETURN_COOKIE);
}

/**
 * Expire the admin-session and return cookies — for signing out of an
 * impersonated session, where `endCurrentSession` ends only the session
 * itself. Never throws: in a Server Component render Next forbids cookie
 * writes, and this runs on teardown paths that must continue.
 */
export async function expireImpersonationCookies(): Promise<void> {
  try {
    const store = await cookies();
    const adminCookie = authCookieName("admin_session");
    if (store.has(adminCookie)) {
      // Not `delete()`: a browser ignores a Set-Cookie for a `__Secure-` name
      // that lacks the Secure flag, so expire it with the attributes it was set with.
      store.set(adminCookie, "", {
        httpOnly: true,
        sameSite: "lax",
        secure: authCookiesSecure(),
        path: "/",
        maxAge: 0,
      });
    }
    if (store.has(RETURN_COOKIE)) store.delete(RETURN_COOKIE);
  } catch (err) {
    console.error("[impersonation-session] expiring impersonation cookies failed:", err);
  }
}

export type ImpersonationState = {
  /** `AuthUser.id` of the Super Admin (`session.impersonatedBy`). */
  adminAuthId: string;
  /** `User.id` of that admin — audit rows key off this. */
  adminUserId: string;
  /** `User.id` of the account being impersonated. */
  targetUserId: string;
  returnTo: ImpersonationReturnTo | null;
  /**
   * Always false: the impersonated session row itself expires after two
   * hours, and then the admin is signed out. Kept so UI written against the
   * old ticket context keeps its shape.
   */
  expired: false;
};

/**
 * The impersonation on this request, or null. Reads the session through the
 * cookie cache (cheap on every render: layouts and the banner call it), so a
 * just-ended impersonation can show for up to five minutes on another tab —
 * UI only. Anything that grants or narrows access uses
 * `isVerifiedImpersonationOf`, which reads the session row.
 *
 * Never throws; an unreadable session or a missing User row reads as null.
 */
export const readImpersonation = cache(async (): Promise<ImpersonationState | null> => {
  try {
    const session = await getAuthSession();
    const adminAuthId = session?.session.impersonatedBy;
    if (!session || !adminAuthId) return null;

    const rows = await prisma.user.findMany({
      where: { authId: { in: [adminAuthId, session.user.id] } },
      select: { id: true, authId: true },
    });
    const admin = rows.find((r) => r.authId === adminAuthId);
    const target = rows.find((r) => r.authId === session.user.id);
    if (!admin || !target) return null;

    const returnRaw = (await cookies()).get(RETURN_COOKIE)?.value;
    return {
      adminAuthId,
      adminUserId: admin.id,
      targetUserId: target.id,
      returnTo: isReturnTo(returnRaw) ? returnRaw : null,
      expired: false,
    };
  } catch (err) {
    console.error("[impersonation-session] readImpersonation failed:", err);
    return null;
  }
});

/**
 * True only when this request's session row — read fresh, not from the
 * cookie cache — is an impersonation (`impersonatedBy` set) of the account
 * whose `User.id` is `userId`. False for everything else, including "could
 * not tell": callers use this to relax a default only when it is proven.
 */
export async function isVerifiedImpersonationOf(userId: string): Promise<boolean> {
  try {
    const session = await getAuthSession({ fresh: true });
    if (!session?.session.impersonatedBy) return false;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { authId: true } });
    return user !== null && user.authId === session.user.id;
  } catch (err) {
    console.error("[impersonation-session] impersonation check failed:", err);
    return false;
  }
}
