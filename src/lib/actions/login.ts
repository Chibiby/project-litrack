"use server";

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
 * `@/lib/auth/auth-errors`). That is exactly what happened: heads whose
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

import { prisma } from "@/lib/prisma";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, SUPABASE_NOT_CONFIGURED_MESSAGE } from "@/lib/supabase/env";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { warmSchoolHeadRoutes, warmTeacherRoutes } from "@/lib/auth/warm-routes";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import {
  DECLINED_REGISTRATION_MESSAGE,
  DEACTIVATED_TEACHER_MESSAGE,
  isDeactivatedTeacher,
} from "@/lib/auth/teacher-registration-helpers";

const LOGIN_RATE = { limit: 10, windowMs: 5 * 60 * 1000 } as const;

const SCHOOL_HEAD_GENERIC_ERROR = "Login failed. Please contact your administrator.";
const TEACHER_GENERIC_ERROR = "Incorrect email or password.";
const TOO_MANY_ATTEMPTS = "Too many attempts. Please try again later.";

/**
 * Where the password grant should be made.
 *
 * `browser` carries the address to sign in with; `server` means the caller must
 * use the server-side action instead.
 */
export type BeginLoginResult =
  | { ok: true; mode: "browser"; email: string }
  | { ok: true; mode: "server" }
  | { ok: false; error: string };

export type FinishLoginResult = { ok: true; redirectTo: string } | { ok: false; error: string };

/** Reasons a failed attempt can be recorded as. Client input, so it is an allow-list. */
export type LoginFailureReason = "incorrect_credentials" | "rate_limited";

function normalizeReason(reason: string): LoginFailureReason {
  return reason === "rate_limited" ? "rate_limited" : "incorrect_credentials";
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
export async function beginSchoolHeadLogin(schoolId: string): Promise<BeginLoginResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: SUPABASE_NOT_CONFIGURED_MESSAGE };
  if (!schoolId) return { ok: false, error: "Please select a school" };

  const rate = await checkRateLimit(`login:school-head:${schoolId}`, LOGIN_RATE);
  if (!rate.ok) return { ok: false, error: TOO_MANY_ATTEMPTS };

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, isActive: true, deletedAt: true },
  });
  if (!school || !school.isActive || school.deletedAt) {
    return { ok: false, error: "School not found or inactive" };
  }

  const head = await findSchoolHead(school.id);
  if (!head) return { ok: false, error: SCHOOL_HEAD_GENERIC_ERROR };

  if (!isSyntheticEmail(head.email)) return { ok: true, mode: "server" };
  return { ok: true, mode: "browser", email: head.email };
}

/**
 * School Head: verify the session the browser just established, then admit it.
 *
 * Everything here is re-derived from cookies and Prisma. The `schoolId` the
 * client passes is only used to confirm it agrees with the account that
 * actually signed in — a mismatch signs the session straight back out rather
 * than trusting either side.
 */
export async function finishSchoolHeadLogin(schoolId: string): Promise<FinishLoginResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { ok: false, error: SCHOOL_HEAD_GENERIC_ERROR };

  const user = await prisma.user.findUnique({
    where: { authId: data.user.id },
    select: { id: true, role: true, schoolId: true, isActive: true, deletedAt: true },
  });

  if (
    !user ||
    user.deletedAt ||
    !user.isActive ||
    user.role !== "SCHOOL_HEAD" ||
    !user.schoolId ||
    user.schoolId !== schoolId
  ) {
    await supabase.auth.signOut();
    await writeAudit({
      userId: user?.id,
      schoolId: user?.schoolId ?? schoolId,
      action: AUDIT_ACTIONS.LOGIN_DENIED,
      resource: "User",
      resourceId: user?.id,
      metadata: { role: "SCHOOL_HEAD", schoolId, reason: "not_authorized" },
    });
    return { ok: false, error: SCHOOL_HEAD_GENERIC_ERROR };
  }

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    resource: "User",
    resourceId: user.id,
    metadata: { role: "SCHOOL_HEAD", schoolId: user.schoolId, method: "browser_password" },
  });

  await warmSchoolHeadRoutes(user.schoolId);

  return { ok: true, redirectTo: SCHOOL_HEAD_ROUTES.dashboard };
}

/**
 * Teacher: run the pre-flight gates and hand the address back for the browser.
 *
 * Always `mode: "browser"` on success — the teacher typed the address
 * themselves, so returning it reveals nothing they did not supply. The gates
 * below are the same ones `loginTeacher` applies, and they run before any
 * password leaves the browser so a declined or deactivated account gets its
 * real explanation instead of a failed grant.
 */
export async function beginTeacherLogin(schoolId: string, rawEmail: string): Promise<BeginLoginResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: SUPABASE_NOT_CONFIGURED_MESSAGE };
  if (!schoolId) return { ok: false, error: "Please select a school" };

  const email = rawEmail.trim().toLowerCase();
  if (!email) return { ok: false, error: "Email is required" };

  const rate = await checkRateLimit(`login:teacher:${schoolId}:${email}`, LOGIN_RATE);
  if (!rate.ok) return { ok: false, error: TOO_MANY_ATTEMPTS };

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, isActive: true, deletedAt: true },
  });
  if (!school || !school.isActive || school.deletedAt) {
    return { ok: false, error: "School not found or inactive" };
  }

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

  if (!teacher || teacher.deletedAt || teacher.role !== "TEACHER" || teacher.schoolId !== schoolId) {
    return {
      ok: false,
      error: "No teacher account found for this school. Create an account first.",
    };
  }
  if (teacher.approvalStatus === "REJECTED") {
    return { ok: false, error: DECLINED_REGISTRATION_MESSAGE };
  }
  if (isDeactivatedTeacher(teacher)) {
    await writeAudit({
      userId: teacher.id,
      schoolId,
      action: AUDIT_ACTIONS.LOGIN_DENIED,
      resource: "User",
      resourceId: teacher.id,
      metadata: { role: "TEACHER", schoolId, reason: "deactivated" },
    });
    return { ok: false, error: DEACTIVATED_TEACHER_MESSAGE };
  }

  return { ok: true, mode: "browser", email };
}

/** Teacher counterpart to `finishSchoolHeadLogin`; see that function for the reasoning. */
export async function finishTeacherLogin(schoolId: string): Promise<FinishLoginResult> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { ok: false, error: TEACHER_GENERIC_ERROR };

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

  if (
    !user ||
    user.deletedAt ||
    user.role !== "TEACHER" ||
    !user.schoolId ||
    user.schoolId !== schoolId ||
    user.approvalStatus === "REJECTED" ||
    isDeactivatedTeacher(user)
  ) {
    await supabase.auth.signOut();
    await writeAudit({
      userId: user?.id,
      schoolId: user?.schoolId ?? schoolId,
      action: AUDIT_ACTIONS.LOGIN_DENIED,
      resource: "User",
      resourceId: user?.id,
      metadata: { role: "TEACHER", schoolId, reason: "not_authorized" },
    });
    return { ok: false, error: TEACHER_GENERIC_ERROR };
  }

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    resource: "User",
    resourceId: user.id,
    metadata: { role: "TEACHER", schoolId: user.schoolId, method: "browser_password" },
  });

  const pending = user.approvalStatus === "PENDING";
  if (!pending) {
    await warmTeacherRoutes({ schoolId: user.schoolId, teacherId: user.id, isSuperAdmin: false });
  }

  return { ok: true, redirectTo: pending ? "/pending-approval" : "/teacher" };
}

/**
 * Record an attempt that failed at the browser's grant.
 *
 * The audit row is the only part of a failed sign-in the server would otherwise
 * never see, and losing it would blind `/admin/audit` to exactly the pattern
 * that made this bug so hard to read. Nothing here trusts the caller: the
 * subject is resolved from the school and role, and `reason` is narrowed to the
 * two values the login form can legitimately report.
 */
export async function reportLoginFailure(input: {
  schoolId: string;
  role: "SCHOOL_HEAD" | "TEACHER";
  reason: string;
  email?: string;
}): Promise<void> {
  const reason = normalizeReason(input.reason);
  if (!input.schoolId) return;

  const subject =
    input.role === "SCHOOL_HEAD"
      ? await findSchoolHead(input.schoolId)
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
}

/**
 * The school's School Head account.
 *
 * `orderBy createdAt asc` is not cosmetic. The Super Admin console's reset
 * (`findSchoolHead` in `./school-accounts`) targets the oldest row, so an
 * unordered lookup here could authenticate against a different account than the
 * one an admin just reset — the reset would appear to do nothing at all. One
 * head per school is not enforced in the schema, so the two lookups have to
 * agree by construction.
 */
async function findSchoolHead(schoolId: string) {
  return prisma.user.findFirst({
    where: { schoolId, role: "SCHOOL_HEAD", deletedAt: null, isActive: true },
    select: { id: true, email: true, schoolId: true },
    orderBy: { createdAt: "asc" },
  });
}
