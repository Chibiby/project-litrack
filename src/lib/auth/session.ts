import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { SpanStatusCode, trace, type Attributes, type Span } from "@opentelemetry/api";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { roleHomePath } from "@/lib/auth/roles";
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

function isTeacherRejected(user: User): boolean {
  return user.role === "TEACHER" && user.approvalStatus === "REJECTED";
}

/** Pending School Head approval only (deactivated approved teachers use isActive below). */
function isTeacherPendingGate(user: User): boolean {
  return user.role === "TEACHER" && user.approvalStatus === "PENDING";
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

function recordSpanError(span: Span, err: unknown): void {
  try {
    span.recordException(err as Error);
    span.setStatus({ code: SpanStatusCode.ERROR });
  } catch (spanErr) {
    logSpanFailure("[session] span error record failed:", spanErr);
  }
}

/** `onRetry` fires before the second attempt, so a retry that then throws is still recorded. */
async function loadUserByAuthId(authId: string, onRetry?: () => void): Promise<User | null> {
  // Retry once on P2024 (pool timeout). Rapid teacher soft-nav + full prefetch
  // can briefly queue past the serverless pool wait; a short backoff clears most
  // transient failures before they hit teacher/error.tsx.
  try {
    return await prisma.user.findUnique({ where: { authId } });
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : "";
    if (code !== "P2024") throw err;
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
  const supabase = await createSupabaseServerClient();

  // Session verification against Supabase Auth. Spans the whole verification step, not
  // one particular client method, so it survives changing how the session is verified.
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
        const {
          data: { user },
        } = await supabase.auth.getUser();
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
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("[session] signOut for deleted user failed:", err);
    }
    return null;
  }

  if (isTeacherRejected(user)) {
    if (allowPending) {
      return user;
    }
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("[session] signOut for rejected teacher failed:", err);
    }
    redirect("/login");
  }

  if (isTeacherPendingGate(user)) {
    if (allowPending) {
      return user;
    }
    redirect("/pending-approval");
  }

  // Soft-deleted already handled. Inactive non-pending users (SH/admin/legacy): sign out.
  if (!user.isActive) {
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.error("[session] signOut for inactive user failed:", err);
    }
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
 * Requires an authenticated user. Optionally enforces role(s).
 * Redirects to the appropriate login page if not authenticated or wrong role.
 * Super Admin can access any role-restricted page (impersonation mode).
 *
 * When the user must change their password, redirects to `/account/set-password`
 * unless `options.allowMustChangePassword` is true.
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
    const isAdminRoute =
      roles === "SUPER_ADMIN" || (Array.isArray(roles) && roles.includes("SUPER_ADMIN"));
    redirect(isAdminRoute ? "/admin/login" : "/login");
  }

  if (user.mustChangePassword && !options?.allowMustChangePassword) {
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
 * Check if user is Super Admin
 */
export function isSuperAdmin(user: User): boolean {
  return user.role === "SUPER_ADMIN";
}

export async function signOut() {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
}
