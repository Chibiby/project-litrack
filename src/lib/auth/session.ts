import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";
import { endCurrentSession, getAuthSession, revokeAllSessions } from "@/lib/auth/auth-session";
import {
  expireImpersonationCookies,
  isVerifiedImpersonationOf,
} from "@/lib/auth/impersonation-session";
import { prisma } from "@/lib/prisma";
import { classifyDbFailure } from "@/lib/db-errors";
import { primeReadMode } from "@/lib/db/read-mode";
import { roleHomePath } from "@/lib/auth/roles";
import { loginPath, type SessionEndReason } from "@/lib/auth/session-end";
import { noteScopeUser } from "@/lib/errors/context";
import { isDeveloperAdmin } from "@/lib/auth/admin-tier";
import { AppError } from "@/lib/errors/app-error";
import type { User, UserRole } from "@prisma/client";

export {
  roleHomePath,
  rolePasswordPath,
  roleSettingsPath,
  roleSettingsProfilePath,
  roleSecurityPath,
} from "@/lib/auth/roles";

/** App user guaranteed to belong to a school (non-null schoolId). */
export type SchoolUser = User & { schoolId: string };

export type GetCurrentUserOptions = {
  /** When true, return pending/rejected teachers without redirecting (pending-approval page). */
  allowPending?: boolean;
};

export type RequireUserOptions = {
  /** When true, allow access even if mustChangePassword is set (set-password flow). */
  allowMustChangePassword?: boolean;
  /** When true, allow TEACHER users who are pending approval. */
  allowPending?: boolean;
};

/**
 * Why `getCurrentUser` returned null, for the redirect that follows it.
 *
 * Per request via `cache()`, alongside the user lookup itself. If the memo is
 * ever unavailable the holder is simply fresh, the reason is null, and the
 * redirect is the plain one it has always been — never a wrong explanation.
 */
const sessionEndNote = cache((): { reason: SessionEndReason | null } => ({ reason: null }));

function isTeacherRejected(user: User): boolean {
  return user.role === "TEACHER" && user.approvalStatus === "REJECTED";
}

/** Pending School Head approval only (deactivated approved teachers use isActive below). */
function isTeacherPendingGate(user: User): boolean {
  return user.role === "TEACHER" && user.approvalStatus === "PENDING";
}

/**
 * Every session teardown here ends impersonation too, and runs this BEFORE the
 * session teardown it accompanies.
 *
 * Its own try, never the teardown's: these paths run in Server Components as well
 * as actions, and in a Server Component Next throws on any cookie write. That
 * throw must not skip the teardown that follows. A leftover admin-session cookie
 * is not a hole — it is bound to the admin's own session row, which the admin
 * plugin only restores through `stopImpersonating` on a live impersonated session.
 */
async function dropImpersonationTicket(): Promise<void> {
  try {
    await expireImpersonationCookies();
  } catch (err) {
    console.error("[session] clearing impersonation cookies on sign-out failed:", err);
  }
}

/**
 * End this person's sessions: every session of the identity (a database
 * delete, which works in a Server Component render), then this browser's
 * cookies, best effort — `nextCookies` swallows cookie writes in an RSC.
 */
async function endAllSessions(authId: string, what: string): Promise<void> {
  try {
    await revokeAllSessions(authId);
  } catch (err) {
    console.error(`[session] revoking sessions for ${what} failed:`, err);
  }
  await endCurrentSession();
}

/** Spans for the two blocking round trips every authenticated request pays for. */
const tracer = trace.getTracer("litrack");

/**
 * Telemetry must never be able to fail a request. `span.end()` delegates to the configured span
 * processors with no guard of its own, so a processor that threw synchronously would escape the
 * `finally` blocks below and *replace* the real completion — turning a successful auth into a 500,
 * or masking a genuine P2024 behind an exporter error. Every telemetry call goes through these
 * helpers, and each swallow is independent so one failure cannot skip the step after it.
 */
function logSpanFailure(message: string, err: unknown): void {
  try {
    console.error(message, err);
  } catch {
    // Reporting a telemetry failure must not fail the request either. Node's global console
    // swallows stream write errors, but inspecting `err` runs first and outside that guard, and
    // the platform log forwarder may have replaced console entirely.
  }
}

/** Attributes and `end()` are guarded separately so a rejected attribute cannot skip the export. */
function endSpan(span: Span, attributes: Attributes): void {
  try {
    span.setAttributes(attributes);
  } catch (err) {
    logSpanFailure("[session] span setAttributes failed:", err);
  }
  try {
    span.end();
  } catch (err) {
    logSpanFailure("[session] span end failed:", err);
  }
}

/**
 * Split the same way, because the ERROR status is the only thing separating a failed span from a
 * genuinely anonymous one (see the `authenticated` comment below): a `recordException` failure must
 * not also cost the status.
 */
function recordSpanError(span: Span, err: unknown): void {
  try {
    span.recordException(err as Error);
  } catch (spanErr) {
    logSpanFailure("[session] span recordException failed:", spanErr);
  }
  try {
    span.setStatus({ code: SpanStatusCode.ERROR });
  } catch (spanErr) {
    logSpanFailure("[session] span setStatus failed:", spanErr);
  }
}

/** `onRetry` fires before the second attempt, so a retry that then throws is still recorded. */
async function loadUserByAuthId(authId: string, onRetry?: () => void): Promise<User | null> {
  // Retry once when the database was unavailable (connection refused/closed,
  // socket timeout, too many connections, admin shutdown, …). This used to key
  // on P2024, which Prisma's client engine never raises, so it never fired. A
  // short backoff clears most transient failures before they hit error.tsx.
  try {
    return await prisma.user.findUnique({ where: { authId } });
  } catch (err) {
    if (classifyDbFailure(err) !== "UNAVAILABLE") throw err;
    await new Promise((r) => setTimeout(r, 75));
    onRetry?.();
    // This await must stay inside the `catch`. Moving it into the `try` above would make a second
    // failure retry again instead of propagating, and no test would catch that — see "Deferred
    // follow-ups (latency & throughput program)" in docs/backlog.md.
    return await prisma.user.findUnique({ where: { authId } });
  }
}

/**
 * Cached by allowPending boolean so React cache() dedupes correctly across callers.
 *
 * The two spans below therefore fire ONCE PER REQUEST, not once per caller — a reader
 * comparing span counts against the number of `requireUser` call sites in a render will
 * see far fewer spans and should not read that as missing instrumentation.
 */
const getCurrentUserCached = cache(async (allowPending: boolean): Promise<User | null> => {
  // Before the first query: a user who just wrote must not read their own
  // row, or anything after it, from Hyperdrive's query cache.
  await primeReadMode();

  // Session verification. Spans the whole verification step, not one particular
  // call, so it survives changing how the session is verified.
  const authUser = await tracer.startActiveSpan(
    "litrack.auth.session_verify",
    async (span) => {
      // Unauthenticated requests skip the network entirely, so keep the two populations apart or
      // the p50 reads as much faster than it is. Recorded in the finally, and with the same
      // truthiness test as the `if (!authUser)` guard below, so the attribute can never disagree
      // with the guard. Note the throw path also reports false, sharing the label with a genuinely
      // anonymous request — filter on span status too if you need those two separated.
      let authenticated = false;
      try {
        // The cookie-cached session read: most renders verify the signed cookie cache and
        // never touch the database for the session. The cost: a revoked session's cache can
        // live up to 15 minutes. Deleted, inactive, and rejected accounts are still
        // refused by the Prisma row checks below, which re-read the User row every request,
        // and impersonation proof reads the session row fresh (`isVerifiedImpersonationOf`).
        const session = await getAuthSession();
        const user = session ? { id: session.user.id } : null;
        authenticated = Boolean(user);
        return user;
      } catch (err) {
        recordSpanError(span, err);
        throw err;
      } finally {
        endSpan(span, { "litrack.session.authenticated": authenticated });
      }
    }
  );
  if (!authUser) return null;

  const user = await tracer.startActiveSpan("litrack.auth.user_lookup", async (span) => {
    // The retry path issues a second findUnique after a 75 ms sleep; without this the span
    // duration reads as one round trip when it was two plus the backoff. Recorded in the finally
    // so a retry that then throws still reports retried=true.
    let retried = false;
    try {
      return await loadUserByAuthId(authUser.id, () => {
        retried = true;
      });
    } catch (err) {
      recordSpanError(span, err);
      throw err;
    } finally {
      endSpan(span, { "litrack.user_lookup.retried": retried });
    }
  });
  if (!user) return null;

  if (user.deletedAt) {
    sessionEndNote().reason = "account_disabled";
    await dropImpersonationTicket();
    await endAllSessions(authUser.id, "deleted user");
    return null;
  }

  if (isTeacherRejected(user)) {
    if (allowPending) {
      return user;
    }
    await dropImpersonationTicket();
    await endAllSessions(authUser.id, "rejected teacher");
    redirect(loginPath("school", "declined"));
  }

  if (isTeacherPendingGate(user)) {
    if (allowPending) {
      return user;
    }
    redirect("/pending-approval");
  }

  // Soft-deleted already handled. Inactive non-pending users (SH/admin/legacy): sign out.
  if (!user.isActive) {
    sessionEndNote().reason = "account_disabled";
    await dropImpersonationTicket();
    await endAllSessions(authUser.id, "inactive user");
    return null;
  }

  return user;
});

/**
 * Returns the authenticated app User, or null.
 * Soft-deleted or inactive users are signed out (best effort) and treated as unauthenticated,
 * except pending teachers (see allowPending / pending-approval redirect).
 */
export async function getCurrentUser(options?: GetCurrentUserOptions): Promise<User | null> {
  return getCurrentUserCached(Boolean(options?.allowPending));
}

/**
 * The signed-in user, or null, with no redirect of any kind.
 *
 * For pages that must render for anyone — the 404 above all. `getCurrentUser`
 * redirects pending and declined teachers, which on a 404 would bounce someone
 * away from the page explaining where they are.
 */
export async function peekCurrentUser(): Promise<User | null> {
  try {
    return await getCurrentUser({ allowPending: true });
  } catch {
    // A 404 must render even when the session or the database is unavailable.
    return null;
  }
}

/**
 * The forced first-sign-in password change belongs to the real person. A Super
 * Admin signed in as them ("Sign in as" / Test Lab) goes straight to the role
 * home instead, and the flag is left for the person's own next sign-in.
 *
 * Proven, never assumed: `isVerifiedImpersonationOf` reads this request's
 * session row fresh and needs `impersonatedBy` set on a session whose user is
 * this person. Anything else, or any error, keeps the redirect.
 */
async function isVerifiedImpersonationOfUser(userId: string): Promise<boolean> {
  try {
    return await isVerifiedImpersonationOf(userId);
  } catch (err) {
    console.error("[session] impersonation check for mustChangePassword failed:", err);
    return false;
  }
}

/**
 * Requires an authenticated user. Optionally enforces role(s).
 * Redirects to the appropriate login page if not authenticated or wrong role.
 * Super Admin can access any role-restricted page (impersonation mode).
 *
 * When the user must change their password, redirects to `/account/set-password`
 * unless `options.allowMustChangePassword` is true, or the request is a verified
 * Super Admin impersonation of this user (see `isVerifiedImpersonationOfUser`).
 *
 * Pending teachers redirect to `/pending-approval` unless `options.allowPending` is true.
 *
 * Signature stays backward-compatible: `requireUser(roles?, allowSuperAdmin?)`.
 */
export async function requireUser(
  roles?: UserRole | UserRole[],
  allowSuperAdmin = true,
  options?: RequireUserOptions
): Promise<User> {
  const user = await getCurrentUser({ allowPending: options?.allowPending });
  if (!user) {
    // Both admin roles sign in at `/admin/login`, so a signed-out visitor to a
    // district page must land there too, not on the school login.
    const wanted = roles === undefined ? [] : Array.isArray(roles) ? roles : [roles];
    const isAdminRoute = wanted.includes("SUPER_ADMIN") || wanted.includes("DISTRICT_ADMIN");
    redirect(loginPath(isAdminRoute ? "admin" : "school", sessionEndNote().reason));
  }

  // Lets an error recorded later in this action or route name the person,
  // without every throw site threading ids through its signature. A no-op
  // outside a wrapped action.
  noteScopeUser({ id: user.id, schoolId: user.schoolId });

  if (
    user.mustChangePassword &&
    !options?.allowMustChangePassword &&
    !(await isVerifiedImpersonationOfUser(user.id))
  ) {
    redirect("/account/set-password");
  }

  if (roles) {
    const allowed = Array.isArray(roles) ? roles : [roles];
    if (allowSuperAdmin && user.role === "SUPER_ADMIN") {
      return user;
    }
    if (!allowed.includes(user.role)) {
      redirect(roleHomePath(user.role));
    }
  }
  return user;
}

/**
 * Like requireUser, but guarantees a non-null schoolId.
 * Redirects to the role home if the user has no school.
 */
export async function requireSchoolUser(
  roles?: UserRole | UserRole[]
): Promise<SchoolUser> {
  const user = await requireUser(roles);
  if (!user.schoolId) {
    redirect(roleHomePath(user.role));
  }
  return user as SchoolUser;
}

/**
 * Developer Controls pages: a Super Admin whose tier is DEVELOPER. A Division
 * Admin gets the admin 404, so the page is hidden rather than refused — the
 * sidebar does not list it either.
 */
export async function requireDeveloperAdminPage(): Promise<User> {
  const user = await requireUser("SUPER_ADMIN");
  if (!isDeveloperAdmin(user)) notFound();
  return user;
}

/**
 * Developer Controls actions: same rule as `requireDeveloperAdminPage`, but
 * thrown as `AUTH_FORBIDDEN` so the `action()` wrapper returns a result.
 */
export async function requireDeveloperAdmin(what: string): Promise<User> {
  const user = await requireUser("SUPER_ADMIN");
  if (!isDeveloperAdmin(user)) {
    throw new AppError("AUTH_FORBIDDEN", {
      params: { what },
      detail: `Division Admin ${user.id} called a Developer Controls action`,
      context: { reason: "not_developer_admin" },
    });
  }
  return user;
}

/**
 * Check if user is Super Admin
 */
export function isSuperAdmin(user: User): boolean {
  return user.role === "SUPER_ADMIN";
}

/**
 * Sign out and end any impersonation with it. The ticket goes here, in the one
 * helper, so every page that signs out through it — `/pending-approval` and
 * `/account/created` today — is covered without repeating the rule at each site.
 */
export async function signOut() {
  await dropImpersonationTicket();
  const session = await getAuthSession({ fresh: true });
  if (!session) {
    await endCurrentSession();
    return;
  }
  // An impersonated session ends alone: revoking the target's other sessions
  // would sign the real person out of their own devices.
  if (session.session.impersonatedBy) {
    await endCurrentSession();
    return;
  }
  await endAllSessions(session.user.id, "sign-out");
}
