"use server";

import { findSignInSchoolHead } from "@/lib/auth/school-head-sign-in";

/**
 * The two server halves of a browser-side sign-in.
 *
 * Why sign in from the browser at all, when `loginSchoolHead` / `loginTeacher`
 * in `./auth` already do it server-side:
 *
 * Supabase Auth rate-limits the password grant *per source IP*. A server action
 * runs in a Vercel function, so every sign-in in the deployment — every school,
 * every teacher — arrives at Supabase from the same small pool of egress
 * addresses and shares one bucket of roughly 30 attempts per five minutes. One
 * school head retrying a forgotten password thirty times locks out every other
 * school for the rest of the window, and the 429 that comes back is
 * indistinguishable from a wrong password unless you look for it (see
 * `@/lib/errors/supabase`). That is exactly what happened: heads whose
 * password was provably correct minutes earlier could not get in, and password
 * resets did nothing, because the password was never the problem.
 *
 * Signing in from the browser puts each person on their own IP bucket, which is
 * what the limit was designed to meter. The server keeps everything that
 * actually needs to be trusted:
 *
 *   `begin*`  — resolves which Supabase account the school's login maps to, and
 *               runs every pre-flight gate (school active, account exists, not
 *               deactivated or declined) before a password is ever sent.
 *   `finish*` — re-reads the session from cookies, re-checks role and tenancy
 *               against Prisma, and only then writes the LOGIN_SUCCESS row and
 *               warms routes. The browser cannot talk its way past this: it
 *               proves nothing, it just holds a session the server verifies.
 *
 * `begin*` can also answer `mode: "server"`, in which case the caller falls
 * back to the original server-side action. See `beginSchoolHeadLogin`.
 */

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { warmSchoolHeadRoutes, warmTeacherRoutes } from "@/lib/auth/warm-routes";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { isDeactivatedTeacher } from "@/lib/auth/teacher-registration-helpers";
import { action } from "@/lib/errors/action";
import { AppError, fieldError, tooManyAttempts } from "@/lib/errors/app-error";
import { reportError } from "@/lib/errors/report";
import type { ActionFailure } from "@/lib/errors/result";
import { LOGIN_FAILURE_REASONS, type LoginFailureReason } from "@/lib/errors/supabase";
import { assertSupabaseConfigured, requireActiveSchool, LOGIN_RATE } from "@/lib/auth/login-gates";
import { assertLookupAllowed, recordFailedLookup } from "@/lib/auth/lookup-throttle";
import { clientIpFrom } from "@/lib/request-ip";

/**
 * Where the password grant should be made.
 *
 * `browser` carries the address to sign in with; `server` means the caller must
 * use the server-side action instead.
 */
type BeginLoginSuccess =
  | { ok: true; mode: "browser"; email: string }
  | { ok: true; mode: "server" };

export type BeginLoginResult = BeginLoginSuccess | ActionFailure;
export type FinishLoginResult = { ok: true; redirectTo: string } | ActionFailure;
export type { LoginFailureReason };

/** Attempts the browser may report per address, so the audit trail cannot be flooded. */
const REPORT_RATE = { limit: 30, windowMs: 10 * 60 * 1000 } as const;

function normalizeReason(reason: string): LoginFailureReason {
  return (LOGIN_FAILURE_REASONS as readonly string[]).includes(reason)
    ? (reason as LoginFailureReason)
    : "incorrect_credentials";
}

/**
 * School Head: resolve the school's sign-in address for the browser.
 *
 * The address is only handed out when it is synthetic (`sh@<schoolIdCode>.…`),
 * which is derived from the School ID already printed on the public schools
 * table — telling the browser costs nothing that selecting the school in the
 * dropdown did not already reveal. A head who has swapped in a real address
 * (their DepEd mailbox, for password recovery) gets `mode: "server"` instead:
 * that address is personal data, and a login page that returns it on demand
 * would be an enumeration endpoint for every School Head's real email.
 */
export const beginSchoolHeadLogin = action(
  "beginSchoolHeadLogin",
  async (schoolId: string): Promise<BeginLoginSuccess> => {
    assertSupabaseConfigured();
    if (!schoolId) throw fieldError("schoolId", "Please select a school");

    const rate = await checkRateLimit(`login:school-head:${schoolId}`, LOGIN_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

    const school = await requireActiveSchool(schoolId);

    const head = await findSignInSchoolHead(school.id);
    if (!head) {
      // Never a password problem, and it never was: the school has no head
      // account at all. Recorded because only an admin can fix it, and the old
      // "contact your administrator" gave them nothing to act on.
      throw new AppError("AUTH_NO_SCHOOL_HEAD_ACCOUNT", {
        detail: `School ${school.id} has no active School Head account`,
        context: { schoolId: school.id, reason: "no_school_head" },
      });
    }

    if (!isSyntheticEmail(head.email)) return { ok: true, mode: "server" };
    return { ok: true, mode: "browser", email: head.email };
  }
);

/**
 * School Head: verify the session the browser just established, then admit it.
 *
 * Everything here is re-derived from cookies and Prisma. The `schoolId` the
 * client passes is only used to confirm it agrees with the account that
 * actually signed in — a mismatch signs the session straight back out rather
 * than trusting either side.
 */
export const finishSchoolHeadLogin = action(
  "finishSchoolHeadLogin",
  async (schoolId: string): Promise<{ ok: true; redirectTo: string }> => {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw new AppError("AUTH_SESSION_EXPIRED", {
        detail: `No session after the browser grant: ${error?.message ?? "no user"}`,
      });
    }

    const user = await prisma.user.findUnique({
      where: { authId: data.user.id },
      select: { id: true, role: true, schoolId: true, isActive: true, deletedAt: true },
    });

    const cause = schoolHeadDenial(user, schoolId);
    if (cause) {
      await supabase.auth.signOut();
      await writeAudit({
        userId: user?.id,
        schoolId: user?.schoolId ?? schoolId,
        action: AUDIT_ACTIONS.LOGIN_DENIED,
        resource: "User",
        resourceId: user?.id,
        metadata: { role: "SCHOOL_HEAD", schoolId, reason: "not_authorized", cause },
      });
      throw new AppError(
        cause === "deleted" || cause === "inactive" ? "AUTH_ACCOUNT_DISABLED" : "AUTH_FORBIDDEN",
        {
          params: { what: "this school" },
          detail: `School Head sign-in refused: ${cause}`,
          context: { schoolId, reason: cause },
        }
      );
    }

    // `schoolHeadDenial` returning null proves every field below is present.
    const admitted = user!;

    await writeAudit({
      userId: admitted.id,
      schoolId: admitted.schoolId,
      action: AUDIT_ACTIONS.LOGIN_SUCCESS,
      resource: "User",
      resourceId: admitted.id,
      metadata: { role: "SCHOOL_HEAD", schoolId: admitted.schoolId, method: "browser_password" },
    });

    await warmSchoolHeadRoutes(admitted.schoolId!);

    return { ok: true, redirectTo: SCHOOL_HEAD_ROUTES.dashboard };
  }
);

/**
 * Teacher: run the pre-flight gates and hand the address back for the browser.
 *
 * Always `mode: "browser"` on success — the teacher typed the address
 * themselves, so returning it reveals nothing they did not supply. The gates
 * below are the same ones `loginTeacher` applies, and they run before any
 * password leaves the browser so a declined or deactivated account gets its
 * real explanation instead of a failed grant.
 */
export const beginTeacherLogin = action(
  "beginTeacherLogin",
  async (schoolId: string, rawEmail: string): Promise<BeginLoginSuccess> => {
    assertSupabaseConfigured();
    if (!schoolId) throw fieldError("schoolId", "Please select a school");

    const email = rawEmail.trim().toLowerCase();
    if (!email) throw fieldError("email", "Email is required");

    const rate = await checkRateLimit(`login:teacher:${schoolId}:${email}`, LOGIN_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

    // Before the lookup, so that once an address has spent its allowance every
    // answer is the same and this stops being an enumeration oracle.
    await assertLookupAllowed();
    await requireActiveSchool(schoolId);

    const teacher = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        role: true,
        schoolId: true,
        isActive: true,
        deletedAt: true,
        approvalStatus: true,
      },
    });

    if (
      !teacher ||
      teacher.deletedAt ||
      teacher.role !== "TEACHER" ||
      teacher.schoolId !== schoolId
    ) {
      await recordFailedLookup();
      throw new AppError("AUTH_TEACHER_NOT_FOUND", { context: { schoolId } });
    }
    if (teacher.approvalStatus === "REJECTED") throw new AppError("AUTH_REGISTRATION_DECLINED");
    if (isDeactivatedTeacher(teacher)) {
      await writeAudit({
        userId: teacher.id,
        schoolId,
        action: AUDIT_ACTIONS.LOGIN_DENIED,
        resource: "User",
        resourceId: teacher.id,
        metadata: { role: "TEACHER", schoolId, reason: "deactivated" },
      });
      throw new AppError("AUTH_ACCOUNT_DEACTIVATED");
    }

    return { ok: true, mode: "browser", email };
  }
);

/** Teacher counterpart to `finishSchoolHeadLogin`; see that function for the reasoning. */
export const finishTeacherLogin = action(
  "finishTeacherLogin",
  async (schoolId: string): Promise<{ ok: true; redirectTo: string }> => {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw new AppError("AUTH_SESSION_EXPIRED", {
        detail: `No session after the browser grant: ${error?.message ?? "no user"}`,
      });
    }

    const user = await prisma.user.findUnique({
      where: { authId: data.user.id },
      select: {
        id: true,
        role: true,
        schoolId: true,
        isActive: true,
        deletedAt: true,
        approvalStatus: true,
      },
    });

    const cause = teacherDenial(user, schoolId);
    if (cause) {
      await supabase.auth.signOut();
      await writeAudit({
        userId: user?.id,
        schoolId: user?.schoolId ?? schoolId,
        action: AUDIT_ACTIONS.LOGIN_DENIED,
        resource: "User",
        resourceId: user?.id,
        metadata: { role: "TEACHER", schoolId, reason: "not_authorized", cause },
      });
      throw new AppError(
        cause === "declined"
          ? "AUTH_REGISTRATION_DECLINED"
          : cause === "deactivated"
            ? "AUTH_ACCOUNT_DEACTIVATED"
            : "AUTH_TEACHER_NOT_FOUND",
        { detail: `Teacher sign-in refused: ${cause}`, context: { schoolId, reason: cause } }
      );
    }

    const admitted = user!;

    await writeAudit({
      userId: admitted.id,
      schoolId: admitted.schoolId,
      action: AUDIT_ACTIONS.LOGIN_SUCCESS,
      resource: "User",
      resourceId: admitted.id,
      metadata: { role: "TEACHER", schoolId: admitted.schoolId, method: "browser_password" },
    });

    const pending = admitted.approvalStatus === "PENDING";
    if (!pending) {
      await warmTeacherRoutes({
        schoolId: admitted.schoolId!,
        teacherId: admitted.id,
        isSuperAdmin: false,
      });
    }

    return { ok: true, redirectTo: pending ? "/pending-approval" : "/teacher" };
  }
);

/**
 * Record an attempt that failed at the browser's grant.
 *
 * The audit row is the only part of a failed sign-in the server would otherwise
 * never see, and losing it would blind `/admin/audit` to exactly the pattern
 * that made this bug so hard to read. Nothing here trusts the caller: the
 * subject is resolved from the school and role, and `reason` is narrowed to the
 * values the login form can legitimately report.
 *
 * A provider failure is recorded at "security" severity rather than "system":
 * the input comes from the browser, and a client-triggered alert would be a way
 * for anyone to flood an inbox.
 */
export const reportLoginFailure = action(
  "reportLoginFailure",
  async (input: {
    schoolId: string;
    role: "SCHOOL_HEAD" | "TEACHER";
    reason: string;
    email?: string;
  }): Promise<{ ok: true }> => {
    const reason = normalizeReason(input.reason);
    if (!input.schoolId) return { ok: true };

    const gate = await checkRateLimit(`login:report:${clientIpFrom(await headers())}`, REPORT_RATE);
    if (!gate.ok) return { ok: true };

    const subject =
      input.role === "SCHOOL_HEAD"
        ? await findSignInSchoolHead(input.schoolId)
        : input.email
          ? await prisma.user.findUnique({
              where: { email: input.email.trim().toLowerCase() },
              select: { id: true, email: true, schoolId: true },
            })
          : null;

    // A teacher row from another school must not be credited to this one.
    const userId =
      subject && (input.role === "SCHOOL_HEAD" || subject.schoolId === input.schoolId)
        ? subject.id
        : null;

    await writeAudit({
      userId,
      schoolId: input.schoolId,
      action: AUDIT_ACTIONS.LOGIN_DENIED,
      resource: "User",
      resourceId: userId,
      metadata: { role: input.role, schoolId: input.schoolId, reason },
    });

    if (reason === "rate_limited" || reason === "provider_error") {
      reportError(
        new AppError(
          reason === "rate_limited" ? "AUTH_PROVIDER_RATE_LIMITED" : "AUTH_PROVIDER_ERROR",
          {
            severity: "security",
            detail: `Reported by the browser after a failed password grant (${input.role})`,
            context: { schoolId: input.schoolId, reason },
          }
        ),
        { route: "reportLoginFailure", userId, schoolId: input.schoolId }
      );
    }

    return { ok: true };
  }
);

type SchoolHeadRow = {
  id: string;
  role: string;
  schoolId: string | null;
  isActive: boolean;
  deletedAt: Date | null;
} | null;

function schoolHeadDenial(user: SchoolHeadRow, schoolId: string): string | null {
  if (!user) return "no_account";
  if (user.deletedAt) return "deleted";
  if (!user.isActive) return "inactive";
  if (user.role !== "SCHOOL_HEAD") return "role_mismatch";
  if (!user.schoolId || user.schoolId !== schoolId) return "school_mismatch";
  return null;
}

type TeacherRow = {
  id: string;
  role: string;
  schoolId: string | null;
  isActive: boolean;
  deletedAt: Date | null;
  // Nullable in the schema — legacy rows predate the approval flow.
  approvalStatus: string | null;
} | null;

function teacherDenial(user: TeacherRow, schoolId: string): string | null {
  if (!user) return "no_account";
  if (user.deletedAt) return "deleted";
  if (user.role !== "TEACHER") return "role_mismatch";
  if (!user.schoolId || user.schoolId !== schoolId) return "school_mismatch";
  if (user.approvalStatus === "REJECTED") return "declined";
  if (isDeactivatedTeacher(user as Parameters<typeof isDeactivatedTeacher>[0])) {
    return "deactivated";
  }
  return null;
}
