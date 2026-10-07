"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { prisma, prismaFresh } from "@/lib/prisma";
import { canonicalAppUrl } from "@/lib/app-url";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import {
  schoolLoginSchema,
  adminLoginSchema,
  teacherLoginSchema,
  teacherRegisterSchema,
  setPasswordSchema,
  changePasswordSchema,
  changeEmailSchema,
  forgotPasswordSchema,
} from "@/lib/validators/auth.schema";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { passwordChangeFields } from "@/lib/auth/password-vault";
import { findSignInSchoolHead } from "@/lib/auth/school-head-sign-in";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { recordLastLogin } from "@/lib/auth/last-login";
import { checkRateLimit, peekRateLimit } from "@/lib/rate-limit";
import { clientIpFrom } from "@/lib/request-ip";
import { action } from "@/lib/errors/action";
import { AppError, tooManyAttempts, type AppErrorOptions } from "@/lib/errors/app-error";
import { formatMessage, type ErrorCode } from "@/lib/errors/codes";
import { parseInput } from "@/lib/errors/validation";
import { loginFailureReasonFor } from "@/lib/errors/auth-provider";
import { reportError } from "@/lib/errors/report";
import type { ActionFailure } from "@/lib/errors/result";
import { assertAuthConfigured, requireActiveSchool, LOGIN_RATE } from "@/lib/auth/login-gates";
import { assertLookupAllowed, recordFailedLookup } from "@/lib/auth/lookup-throttle";
import { requireUser, roleHomePath, roleSecurityPath } from "@/lib/auth/session";
import { readTestLabSession } from "@/lib/auth/test-lab";
import {
  endCurrentSession,
  getAuthSession,
  revokeAllSessions,
  revokeOtherSessions,
  signInWithPassword,
} from "@/lib/auth/auth-session";
import {
  createIdentity,
  findIdentityByEmail,
  setEmail,
  setPassword,
  verifyAccountPassword,
} from "@/lib/auth/identity";
import { DUMMY_BCRYPT_HASH, hashPassword, verifyPassword } from "@/lib/auth/password-hash";
import { consumeResetToken, peekResetToken } from "@/lib/auth/password-reset";
import { authCookieName, authCookiesSecure } from "@/lib/auth/auth-cookies";
import {
  expireImpersonationCookies,
  isVerifiedImpersonationOf,
  readImpersonation,
} from "@/lib/auth/impersonation-session";
import { clearDemoSessionCookie } from "@/lib/demo/session";
import { completeTeacherAuthAfterVerify } from "@/lib/auth/teacher-registration";
import {
  sendPasswordRecoveryEmail,
  hasRecentRecoveryToken,
  RESET_COOKIE,
  RESET_COOKIE_PATH,
} from "@/lib/auth/recovery-email";
import {
  warmAdminRoutes,
  warmDistrictRoutes,
  warmSchoolHeadRoutes,
  warmTeacherRoutes,
} from "@/lib/auth/warm-routes";
import {
  isDeactivatedTeacher,
  isPendingTeacherAtSchool,
  registerConflictCode,
} from "@/lib/auth/teacher-registration-helpers";

/**
 * Test Lab dry-run result shape for the four self-bound account saves. Never
 * carries a password: the preview says the input passed validation and
 * nothing was changed. `changeEmailAction` is the one exception allowed to
 * show the (already-validated) new address.
 */
type DryRunResult<TPreview> = { ok: true; data: { dryRun: true; preview: TPreview } };

export type PasswordDryRunPreview = { validated: true; changed: false };
export type EmailDryRunPreview = { validated: true; changed: false; newEmail: string };

const REGISTER_RATE = { limit: 5, windowMs: 15 * 60 * 1000 } as const;
const RECOVERY_RATE = { limit: 5, windowMs: 15 * 60 * 1000 } as const;
const PASSWORD_RATE = { limit: 10, windowMs: 15 * 60 * 1000 } as const;
const EMAIL_RATE = { limit: 10, windowMs: 15 * 60 * 1000 } as const;
// Failed admin sign-ins per client address: 20 per 15 minutes. Generous enough
// for a school network behind one NAT, far below a credential-stuffing run.
const ADMIN_FAILED_IP_RATE = { limit: 20, windowMs: 15 * 60 * 1000 } as const;
// Failed School Head and teacher sign-ins per client address, shared by both
// forms: the same 20 per 15 minutes as the admin console. Sign-in now verifies
// the password in-app, so this is the per-address backstop the hosted
// provider's limiter used to be.
const SCHOOL_FAILED_IP_RATE = { limit: 20, windowMs: 15 * 60 * 1000 } as const;
// A failed admin sign-in is never answered sooner than this after it began.
const ADMIN_FAILURE_MIN_MS = 800;
// Only one reset link is live per account (issuing one kills the older ones);
// resending sooner than this only burns the still-good earlier email for an
// identical new one.
const RECOVERY_TOKEN_COOLDOWN_MS = 2 * 60 * 1000;

/** Rate-limit key for failed School Head / teacher sign-ins from this address. */
async function schoolFailedIpKey(): Promise<string> {
  return `login:school-fail:ip:${clientIpFrom(await headers())}`;
}

/**
 * Throw `tooManyAttempts` when this address has used up its failed-sign-in
 * budget. Peeks only: a success never costs anything.
 */
async function assertSchoolIpAllowed(ipKey: string): Promise<void> {
  const gate = await peekRateLimit(ipKey, SCHOOL_FAILED_IP_RATE);
  if (!gate.ok) throw tooManyAttempts(gate.retryAfterMs);
}

/** Charge one wrong password to this address. Never throws (memory fallback). */
async function chargeSchoolIpFailure(ipKey: string): Promise<void> {
  await checkRateLimit(ipKey, SCHOOL_FAILED_IP_RATE);
}

/**
 * Undo a session `signInWithPassword` created earlier in this same request.
 *
 * `endCurrentSession` cannot: it signs out whatever session the INCOMING
 * request carries, and the new session's cookie only exists on the outgoing
 * response. So delete the identity's session rows and expire the two cookies
 * the sign-in just set.
 */
async function discardNewSession(authId: string): Promise<void> {
  await revokeAllSessions(authId);
  const store = await cookies();
  for (const name of ["session_token", "session_data"]) {
    store.set(authCookieName(name), "", {
      httpOnly: true,
      sameSite: "lax",
      secure: authCookiesSecure(),
      path: "/",
      maxAge: 0,
    });
  }
}

/**
 * An `AppError` that also names the form field(s) the message belongs to, so
 * the form can highlight them. The message is the formatted catalog text, the
 * same sentence the toast shows.
 */
function errorOnFields(
  code: ErrorCode,
  fields: string[],
  options: AppErrorOptions = {}
): AppError {
  const message = formatMessage(code, options.params);
  return new AppError(code, {
    ...options,
    fieldErrors: Object.fromEntries(fields.map((field) => [field, message])),
  });
}

/**
 * Site origin for links that go out in email (password recovery).
 *
 * Built ONLY from the canonical `NEXT_PUBLIC_APP_URL`. The `Origin` and
 * `Host` / `x-forwarded-host` headers are client-controlled for any
 * non-browser caller (Next's Server Action CSRF check just compares them with
 * each other), so using them would let an attacker obtain a genuine recovery
 * link that points at their own host. Localhost is allowed only outside
 * production, so local dev without the env var still works; in production a
 * missing value falls back to the same canonical base `email.ts` uses.
 */
function resolveRequestOrigin(): string {
  if (!process.env.NEXT_PUBLIC_APP_URL?.trim() && process.env.NODE_ENV !== "production") {
    return "http://localhost:3000";
  }
  return canonicalAppUrl();
}

/**
 * School Head login: school selection + password (activation credential or private password).
 * Sign-in uses the SH account's stored Prisma email (synthetic by default, or changed later).
 */
export const loginSchoolHead = action(
  "loginSchoolHead",
  async (formData: FormData): Promise<never> => {
    assertAuthConfigured();

    const input = parseInput(schoolLoginSchema, {
      schoolId: formData.get("schoolId"),
      role: "SCHOOL_HEAD",
      password: formData.get("password"),
    });

    const ipKey = await schoolFailedIpKey();
    await assertSchoolIpAllowed(ipKey);

    const rate = await checkRateLimit(`login:school-head:${input.schoolId}`, LOGIN_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

    const school = await requireActiveSchool(input.schoolId);

    // Shared with every reveal/reset/impersonation control so duplicate head
    // rows cannot make an admin act on a different account than sign-in uses.
    const shUser = await findSignInSchoolHead(school.id);
    if (!shUser) {
      throw new AppError("AUTH_NO_SCHOOL_HEAD_ACCOUNT", {
        detail: `School ${school.id} has no active School Head account`,
        context: { schoolId: school.id, reason: "no_school_head" },
      });
    }

    const signIn = await signInWithPassword(shUser.email, input.password);
    if (!signIn.ok) {
      // Once the school is chosen and the account exists, a wrong password is a
      // wrong password — and this used to say "contact your administrator",
      // which is what sent schools off resetting credentials that were fine.
      const { code, error } = signIn;
      if (code === "AUTH_INCORRECT_PASSWORD") await chargeSchoolIpFailure(ipKey);
      await writeAudit({
        userId: shUser.id,
        schoolId: school.id,
        action: AUDIT_ACTIONS.LOGIN_DENIED,
        resource: "User",
        resourceId: shUser.id,
        metadata: {
          role: "SCHOOL_HEAD",
          schoolId: school.id,
          reason: loginFailureReasonFor(code),
        },
      });
      const options = { cause: error, context: { schoolId: school.id } };
      throw code === "AUTH_INCORRECT_PASSWORD"
        ? errorOnFields(code, ["password"], options)
        : new AppError(code, options);
    }

    await writeAudit({
      userId: shUser.id,
      schoolId: school.id,
      action: AUDIT_ACTIONS.LOGIN_SUCCESS,
      resource: "User",
      resourceId: shUser.id,
      metadata: { role: "SCHOOL_HEAD", schoolId: school.id },
    });
    await recordLastLogin(shUser.id);

    await warmSchoolHeadRoutes(school.id);

    redirect(SCHOOL_HEAD_ROUTES.dashboard);
  },
  { verb: "sign you in" }
);

/**
 * Teacher login with email + password only (no OTP / codes).
 */
export const loginTeacher = action("loginTeacher", async (formData: FormData): Promise<never> => {
  assertAuthConfigured();

  const input = parseInput(teacherLoginSchema, {
    schoolId: formData.get("schoolId"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  const email = input.email.toLowerCase().trim();
  const { schoolId, password } = input;

  const ipKey = await schoolFailedIpKey();
  await assertSchoolIpAllowed(ipKey);

  const rate = await checkRateLimit(`login:teacher:${schoolId}:${email}`, LOGIN_RATE);
  if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

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
    throw errorOnFields("AUTH_TEACHER_NOT_FOUND", ["email"], { context: { schoolId } });
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

  const signIn = await signInWithPassword(email, password);
  if (!signIn.ok) {
    const { code, error } = signIn;
    if (code === "AUTH_INCORRECT_PASSWORD") await chargeSchoolIpFailure(ipKey);
    await writeAudit({
      userId: teacher.id,
      schoolId,
      action: AUDIT_ACTIONS.LOGIN_DENIED,
      resource: "User",
      resourceId: teacher.id,
      metadata: { role: "TEACHER", schoolId, reason: loginFailureReasonFor(code) },
    });
    const options = { cause: error, context: { schoolId } };
    throw code === "AUTH_INCORRECT_PASSWORD"
      ? errorOnFields(code, ["password"], options)
      : new AppError(code, options);
  }

  await writeAudit({
    userId: teacher.id,
    schoolId,
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    resource: "User",
    resourceId: teacher.id,
    metadata: { role: "TEACHER", schoolId, method: "password" },
  });
  await recordLastLogin(teacher.id);

  // REJECTED / deactivated already returned above.
  const pending = teacher.approvalStatus === "PENDING";
  if (!pending) {
    // PENDING teachers land on /pending-approval and never read this data.
    await warmTeacherRoutes({
      schoolId,
      teacherId: teacher.id,
      isSuperAdmin: false,
    });
  }

  redirect(pending ? "/pending-approval" : "/teacher");
}, { verb: "sign you in" });

type TeacherRegisterNames = {
  firstName: string;
  middleName?: string;
  lastName: string;
};

/**
 * Self-register outcome. The destination is returned instead of redirected to:
 * the browser must apply the Set-Cookie from this action before requesting the
 * success page, otherwise that page sees no session and bounces to /login.
 */
export type TeacherRegisterResult = { ok: true; redirectTo: string } | ActionFailure;

/** Success page for a teacher awaiting School Head approval. */
const REGISTER_PENDING_PATH = "/account/created";

/**
 * Create or link the LITRACK row for a teacher whose identity exists. Runs
 * BEFORE any session is created, so a refusal leaves nothing to sign out.
 * Returns the page the client should navigate to on success.
 */
async function finishTeacherRegister(params: {
  authId: string;
  email: string;
  schoolId: string;
  names: TeacherRegisterNames;
  isAralVolunteer: boolean;
}): Promise<{ ok: true; redirectTo: string }> {
  const result = await completeTeacherAuthAfterVerify({
    authId: params.authId,
    email: params.email,
    schoolId: params.schoolId,
    intent: "register",
    names: params.names,
    isAralVolunteer: params.isAralVolunteer,
  });

  if (!result.ok) {
    // The password is already proven. If PENDING exists, never toast failure
    // — a peer create or post-create glitch already succeeded for this
    // email+school.
    const existing = await prisma.user.findUnique({
      where: { email: params.email },
      select: {
        id: true,
        authId: true,
        role: true,
        schoolId: true,
        approvalStatus: true,
        deletedAt: true,
      },
    });
    if (existing && isPendingTeacherAtSchool(existing, params.schoolId)) {
      if (existing.authId !== params.authId) {
        try {
          await prisma.user.update({
            where: { id: existing.id },
            data: { authId: params.authId },
          });
        } catch (err) {
          console.error("[registerTeacher] authId link after pending recover:", err);
        }
      }
      return { ok: true, redirectTo: REGISTER_PENDING_PATH };
    }

    // An AppError, carried up so the wrapper answers with it. No session was
    // created yet, so there is nothing to sign out.
    throw result.error;
  }

  return {
    ok: true,
    redirectTo: result.outcome === "approved" ? "/teacher" : REGISTER_PENDING_PATH,
  };
}

/**
 * Create the sign-in identity for a self-registering teacher with the email
 * already marked verified: account creation does not prove the address with a
 * one-time code — School Head approval is the gate, and email is kept only for
 * password recovery.
 *
 * An identity can already exist without a LITRACK row (the Prisma conflict
 * check above ran first): that is an abandoned earlier attempt, so adopt it
 * when the same password matches rather than dead-ending the teacher.
 */
async function createOrAdoptTeacherIdentity(params: {
  email: string;
  password: string;
}): Promise<string> {
  const { email, password } = params;
  // Hashed once, outside any transaction, and reused if the create races.
  const hash = await hashPassword(password);

  try {
    const { authId } = await createIdentity({
      email,
      password: { hash },
      role: "TEACHER",
      emailVerified: true,
    });
    return authId;
  } catch (err) {
    if (!(err instanceof AppError && err.code === "AUTH_EMAIL_IN_USE")) throw err;
  }

  const existing = await findIdentityByEmail(email);
  if (!existing || !(await verifyAccountPassword(existing.authId, password))) {
    throw new AppError("AUTH_ACCOUNT_EXISTS_SIGN_IN");
  }
  return existing.authId;
}

/**
 * Teacher self-registration in a single step: names, email, password.
 *
 * There is no verification code. The account is created PENDING and the School
 * Head approves it before the teacher can use LITRACK; email is used only for
 * password recovery. Returns the destination on success so the client navigates
 * after the session cookies land, or an error message on failure.
 */
export const registerTeacher = action(
  "registerTeacher",
  async (formData: FormData): Promise<{ ok: true; redirectTo: string }> => {
    assertAuthConfigured();

    const input = parseInput(teacherRegisterSchema, {
      schoolId: formData.get("schoolId"),
      email: formData.get("email"),
      firstName: formData.get("firstName") || undefined,
      middleName: formData.get("middleName") || undefined,
      lastName: formData.get("lastName") || undefined,
      // Unticked checkboxes send nothing, so absence is `false` — and the string
      // "false" must be false too, since the client posts the flag explicitly.
      isAralVolunteer: formData.get("isAralVolunteer") === "true",
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    });

    const email = input.email.toLowerCase().trim();
    const { schoolId, password } = input;
    const names: TeacherRegisterNames = {
      firstName: input.firstName.trim(),
      middleName: input.middleName?.trim() || undefined,
      lastName: input.lastName.trim(),
    };

    const rate = await checkRateLimit(`register:teacher:${schoolId}:${email}`, REGISTER_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

    await assertLookupAllowed();
    await requireActiveSchool(schoolId);

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && !existing.deletedAt) {
      // A conflict answers the same question sign-in does — "does this address
      // have an account?" — so it costs the same allowance.
      await recordFailedLookup();
      throw new AppError(registerConflictCode(existing, schoolId));
    }

    const authId = await createOrAdoptTeacherIdentity({ email, password });

    // The LITRACK row first, then the session: a refusal here (a conflict
    // that appeared since the check above) must not leave a signed-in browser
    // behind. An identity without a row is recovered by the adopt path above
    // on the next attempt.
    const outcome = await finishTeacherRegister({
      authId,
      email,
      schoolId,
      names,
      isAralVolunteer: input.isAralVolunteer,
    });

    // Sign in so the browser holds a session for /account/created.
    const signIn = await signInWithPassword(email, password);
    if (!signIn.ok) {
      // The account exists; only the automatic sign-in failed. Telling them to
      // sign in is the one instruction that actually works here.
      throw new AppError("AUTH_REGISTERED_SIGN_IN", { cause: signIn.error });
    }

    return outcome;
  },
  { verb: "create your account" }
);

/** The roles that sign in at `/admin/login`: the division office and district admins. */
const ADMIN_CONSOLE_ROLES = ["SUPER_ADMIN", "DISTRICT_ADMIN"] as const;
type AdminConsoleRole = (typeof ADMIN_CONSOLE_ROLES)[number];

function isAdminConsoleRole(role: string): role is AdminConsoleRole {
  return (ADMIN_CONSOLE_ROLES as readonly string[]).includes(role);
}

/**
 * Admin login (Super Admin or district admin): username + password.
 *
 * The console signs in by handle rather than by email, but the identity only
 * authenticates on an address — so the handle is resolved against
 * `User.username` here and the row's `email` is what actually signs in.
 * Password recovery is unaffected and still runs entirely off that email.
 *
 * Each role lands on its own home: `/admin` for the division office,
 * `/district` for a district admin. A district admin's first sign-in is then
 * forced through `/account/set-password` by `requireUser`.
 */
export const loginAdmin = action("loginAdmin", async (formData: FormData): Promise<never> => {
  const startedAt = Date.now();
  assertAuthConfigured();

  const { username, password } = parseInput(adminLoginSchema, {
    username: formData.get("username"),
    password: formData.get("password"),
  });

  // Per-address ceiling on FAILED attempts, checked before the database or
  // any password check is touched. Only failures are charged (see `failAdminLogin`), so a
  // successful sign-in on a shared school network is refused only once that
  // address has itself burned through the budget.
  const ipKey = `login:admin-fail:ip:${clientIpFrom(await headers())}`;
  const ipGate = await peekRateLimit(ipKey, ADMIN_FAILED_IP_RATE);
  if (!ipGate.ok) throw tooManyAttempts(ipGate.retryAfterMs);

  const rate = await checkRateLimit(`login:admin:${username}`, LOGIN_RATE);
  if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

  {
    // The identity authenticates on an email address, so the handle has to be
    // resolved to one before we can hand anything to `signInWithPassword`.
    //
    // Scoping the lookup to an active, non-deleted admin-console account is the
    // point of doing it here rather than after sign-in: a handle that once
    // belonged to a revoked account, or to a School Head or teacher, never
    // reaches a password check at all, so a stale username cannot be used to
    // probe for a live password.
    const account = await prisma.user.findFirst({
      where: {
        username,
        role: { in: [...ADMIN_CONSOLE_ROLES] },
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, email: true, role: true },
    });
    if (!account) {
      await writeAudit({
        action: AUDIT_ACTIONS.LOGIN_DENIED,
        resource: "User",
        // The username itself is deliberately not logged — an audit row for a
        // failed attempt would otherwise record whatever a stranger typed. The
        // role is unknown too, so the row names the console, not a role.
        metadata: { role: "ADMIN_CONSOLE", reason: "unknown_username" },
      });
      // Spend the same bcrypt work a real handle's password check would, so an
      // unknown handle is not measurably cheaper to refuse. The result is
      // ignored: nothing can match a hash of a value nobody knows.
      await verifyPassword({ hash: DUMMY_BCRYPT_HASH, password });
      // Identical to the wrong-password message below, so the field cannot be
      // used to enumerate which handles exist. This is the one login where the
      // generic message is deliberate: these are the highest-value accounts in
      // the system, and unlike a teacher there is no legitimate "did I type my
      // address wrong?" confusion to resolve.
      return failAdminLogin(startedAt, ipKey, incorrectAdminCredentials());
    }

    const signIn = await signInWithPassword(account.email, password);
    if (!signIn.ok) {
      const { code: mapped, error } = signIn;
      await writeAudit({
        userId: account.id,
        action: AUDIT_ACTIONS.LOGIN_DENIED,
        resource: "User",
        resourceId: account.id,
        metadata: { role: account.role, reason: loginFailureReasonFor(mapped) },
      });
      // Collapsed to the same message as an unknown handle — but only for the
      // credential case. A rate limit or an outage still says what it is.
      if (mapped === "AUTH_INCORRECT_PASSWORD") {
        return failAdminLogin(startedAt, ipKey, incorrectAdminCredentials(error));
      }
      throw new AppError(mapped, { cause: error });
    }

    const user = await prisma.user.findUnique({ where: { authId: signIn.authId } });
    if (!user || !isAdminConsoleRole(user.role) || !user.isActive || user.deletedAt) {
      // Only reachable when the identity behind this email maps to some other
      // (or no) LITRACK row — drift between the two, never a normal sign-in.
      await discardNewSession(signIn.authId);
      await writeAudit({
        userId: user?.id,
        action: AUDIT_ACTIONS.LOGIN_DENIED,
        resource: "User",
        resourceId: user?.id,
        metadata: { role: user?.role ?? "UNKNOWN", reason: "not_authorized" },
      });
      return failAdminLogin(
        startedAt,
        ipKey,
        new AppError("AUTH_FORBIDDEN", {
          params: { what: "the admin console" },
          detail: `Signed in, but the account is not an active admin-console account (role ${user?.role ?? "none"})`,
          context: { reason: "not_admin_console_role" },
        })
      );
    }

    await writeAudit({
      userId: user.id,
      action: AUDIT_ACTIONS.LOGIN_SUCCESS,
      resource: "User",
      resourceId: user.id,
      metadata: { role: user.role },
    });
    await recordLastLogin(user.id);

    if (user.role === "SUPER_ADMIN") {
      await warmAdminRoutes();
    } else {
      await warmDistrictRoutes(user);
    }

    redirect(roleHomePath(user.role));
  }
  // Configuration failures throw CONFIG_MISSING from where they happen, and
  // the wrapper gives the person a reference while the variable names go to
  // the error record.
}, { verb: "sign you in" });

/**
 * Charge a failed admin sign-in to its address, then hold the response until
 * `ADMIN_FAILURE_MIN_MS` has passed since the action began. An unknown handle
 * skips the identity lookup and session write, so without the floor it would
 * answer measurably faster than a real account with a wrong password.
 */
async function failAdminLogin(startedAt: number, ipKey: string, err: AppError): Promise<never> {
  // checkRateLimit never throws (it falls back to memory), so the pad always runs.
  await checkRateLimit(ipKey, ADMIN_FAILED_IP_RATE);
  const remaining = ADMIN_FAILURE_MIN_MS - (Date.now() - startedAt);
  if (remaining > 0) await sleep(remaining);
  throw err;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The one message for both an unknown handle and a wrong password, attached to
 * both inputs so neither field's highlight reveals which one was wrong.
 */
function incorrectAdminCredentials(cause?: unknown): AppError {
  return errorOnFields("AUTH_INCORRECT_CREDENTIALS", ["username", "password"], { cause });
}

/**
 * Deliberately NOT wrapped by `action()`.
 *
 * This is passed straight to `<form action={logoutAction}>`, whose signature
 * requires `Promise<void>` — and a form action has no way to read a returned
 * result anyway, so the wrapper would add a type error and nothing else. It
 * always redirects; anything that escapes is recorded by `onRequestError`.
 */
export async function logoutAction(): Promise<void> {
  // Fresh: whether this session is an impersonation decides how much of it
  // ends, so it must come from the session row, not a cookie cache.
  const session = await getAuthSession({ fresh: true });
  let appUserId: string | null = null;
  let schoolId: string | null = null;
  if (session) {
    const row = await prisma.user.findUnique({
      where: { authId: session.user.id },
      select: { id: true, schoolId: true },
    });
    appUserId = row?.id ?? null;
    schoolId = row?.schoolId ?? null;
  }

  const adminAuthId = session?.session.impersonatedBy ?? null;
  if (adminAuthId) {
    // An admin inside an impersonation ends ONLY the impersonation session:
    // revoking every session the target has would log a teacher out of their
    // own phone and laptop because an admin clicked Sign out in their sidebar.
    // The row is deleted server-side, not merely dropped from this browser.
    //
    // Keep the admin-session cookie until that delete is confirmed: clearing
    // it first on a failure would strand the admin in the target session with
    // no way back.
    if (!(await endCurrentSession())) {
      throw new AppError("AUTH_PROVIDER_ERROR", {
        detail: "Ending the impersonated session failed; admin session cookie retained",
      });
    }
    await expireImpersonationCookies();
  } else {
    // Everywhere, as the old provider's default global sign-out did. The
    // revoke is a plain row delete, so it holds even if the cookie-clearing
    // call above it fails.
    await endCurrentSession();
    if (session) await revokeAllSessions(session.user.id);
  }

  // Signing out ends the demo too. "Open demo session" promises the training
  // tenant disappears when the sitting ends, and the sitting usually ends here:
  // the admin signed in as the demo School Head to record, and this is the
  // click that leaves it. A cookie left behind would keep showing demo schools
  // on the very next visit to /login in this browser.
  await clearDemoSessionCookie();

  if (adminAuthId) {
    const admin = await prisma.user.findUnique({
      where: { authId: adminAuthId },
      select: { id: true },
    });
    await writeAudit({
      userId: admin?.id ?? null,
      schoolId,
      action: AUDIT_ACTIONS.IMPERSONATION_END,
      resource: "User",
      resourceId: appUserId,
    });
  }
  await writeAudit({
    userId: appUserId,
    schoolId,
    action: AUDIT_ACTIONS.LOGOUT,
    resource: "User",
    resourceId: appUserId,
  });
  redirect("/login");
}

/**
 * Write a new password for a signed-in account: the identity's credential and
 * the `User` flags/vault (`passwordChangeFields`) commit together or not at
 * all. bcrypt runs first, outside the transaction, so ~100 ms of hashing never
 * holds row locks. Every other session of the account is then ended (the
 * current one stays), as the old provider did on a user-driven change.
 */
async function savePassword(
  user: { id: string; authId: string; role: Parameters<typeof passwordChangeFields>[0] },
  password: string
): Promise<void> {
  const hash = await hashPassword(password);
  await prismaFresh.$transaction(async (tx) => {
    await setPassword(user.authId, { hash }, tx);
    await tx.user.update({
      where: { id: user.id },
      data: passwordChangeFields(user.role, password),
    });
  });
  const current = await getAuthSession({ fresh: true });
  await revokeOtherSessions(user.authId, current?.session.token ?? null);
}

/**
 * Re-authentication before a credential change. Checks the stored hash only;
 * it creates no session and leaves the current one alone.
 */
async function assertCurrentPassword(authId: string, currentPassword: string): Promise<void> {
  if (await verifyAccountPassword(authId, currentPassword)) return;
  throw errorOnFields("AUTH_CURRENT_PASSWORD_INCORRECT", ["currentPassword"]);
}

/**
 * Forced first-login / activation password change (current session).
 */
export const setPasswordAction = action(
  "setPasswordAction",
  async (formData: FormData): Promise<DryRunResult<PasswordDryRunPreview>> => {
    assertAuthConfigured();

    const user = await requireUser(undefined, true, { allowMustChangePassword: true });

    const rate = await checkRateLimit(`password:set:${user.id}`, PASSWORD_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

    const input = parseInput(setPasswordSchema, {
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    });

    if (await readTestLabSession(user)) {
      return { ok: true, data: { dryRun: true, preview: { validated: true, changed: false } } };
    }

    await savePassword(user, input.password);

    await writeAudit({
      userId: user.id,
      schoolId: user.schoolId,
      action: AUDIT_ACTIONS.PASSWORD_CHANGE,
      resource: "User",
      resourceId: user.id,
      metadata: { reason: "set_password" },
    });

    redirect(roleHomePath(user.role));
  },
  { verb: "save your new password" }
);

/**
 * Dismiss the first-login password prompt and keep the current credential.
 *
 * The prompt is a nudge, not a gate: a School Head who has just been handed
 * their School ID should be able to get into the app and come back to this
 * later. Only `mustChangePassword` is cleared — `passwordIsSchoolId` is left
 * exactly as it was, because skipping means the password did NOT change, and
 * lying about that would make the Super Admin console show a credential that
 * does not work.
 *
 * The account's password is unchanged and may still be the School ID, which is
 * public. `/account/password` remains available from Settings → Security, and
 * a Super Admin can always reset the account back to the School ID.
 */
export const skipPasswordChange = action(
  "skipPasswordChange",
  async (): Promise<DryRunResult<PasswordDryRunPreview>> => {
  const user = await requireUser(undefined, true, { allowMustChangePassword: true });

  if (user.role === "TEACHER") {
    throw new AppError("AUTH_FORBIDDEN", {
      detail: "Teachers must choose a new password after an administrator reset it",
    });
  }

  if (await readTestLabSession(user)) {
    return { ok: true, data: { dryRun: true, preview: { validated: true, changed: false } } };
  }

  // A Super Admin signed in as this account never clears the real person's
  // first-sign-in prompt: no write, no audit row, just their role home (which
  // `requireUser` lets a verified impersonation reach). The proof is the
  // session row's `impersonatedBy`, read fresh. An impersonation of this
  // account that the cookie cache shows but the fresh read cannot confirm
  // (a read failure, a session just ended) is refused rather than written
  // through: the flag is only ever cleared with no impersonation in play.
  const impersonatingThisUser = (await readImpersonation())?.targetUserId === user.id;
  if (impersonatingThisUser) {
    if (await isVerifiedImpersonationOf(user.id)) {
      redirect(roleHomePath(user.role));
    }
    throw new AppError("AUTH_FORBIDDEN", {
      params: { what: "this account" },
      detail: `skipPasswordChange refused: impersonation of ${user.id} shown but not proven by the session row`,
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { mustChangePassword: false },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.PASSWORD_CHANGE,
    resource: "User",
    resourceId: user.id,
    // No password changed here. The reason string is what separates this row
    // from a real change when someone audits the account later.
    metadata: { reason: "set_password_skipped", changed: false },
  });

  redirect(roleHomePath(user.role));
  }
);

/**
 * Voluntary password change — requires verifying the current password first.
 */
export const changePasswordAction = action(
  "changePasswordAction",
  async (
    formData: FormData
  ): Promise<{ ok: true; data?: { dryRun: true; preview: PasswordDryRunPreview } }> => {
    assertAuthConfigured();

    const user = await requireUser();

    const rate = await checkRateLimit(`password:change:${user.id}`, PASSWORD_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

    const input = parseInput(changePasswordSchema, {
      currentPassword: formData.get("currentPassword"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    });

    if (await readTestLabSession(user)) {
      return { ok: true, data: { dryRun: true, preview: { validated: true, changed: false } } };
    }

    await assertCurrentPassword(user.authId, input.currentPassword);

    await savePassword(user, input.password);

    await writeAudit({
      userId: user.id,
      schoolId: user.schoolId,
      action: AUDIT_ACTIONS.PASSWORD_CHANGE,
      resource: "User",
      resourceId: user.id,
      metadata: { reason: "change_password" },
    });

    return { ok: true };
  },
  { verb: "change your password" }
);

/**
 * Change account email — re-auth with current password, then write the
 * identity's and the `User` row's address in one transaction.
 */
export const changeEmailAction = action(
  "changeEmailAction",
  async (
    formData: FormData
  ): Promise<{ ok: true; data?: { dryRun: true; preview: EmailDryRunPreview } }> => {
    assertAuthConfigured();

    const user = await requireUser();

    const rate = await checkRateLimit(`email:change:${user.id}`, EMAIL_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

    const input = parseInput(changeEmailSchema, {
      newEmail: formData.get("newEmail"),
      confirmEmail: formData.get("confirmEmail"),
      currentPassword: formData.get("currentPassword"),
    });

    const newEmail = input.newEmail.trim().toLowerCase();
    if (newEmail === user.email.trim().toLowerCase()) throw new AppError("AUTH_EMAIL_UNCHANGED");

    if (await readTestLabSession(user)) {
      return {
        ok: true,
        data: { dryRun: true, preview: { validated: true, changed: false, newEmail } },
      };
    }

    await assertCurrentPassword(user.authId, input.currentPassword);

    const taken = await prisma.user.findFirst({
      where: { email: newEmail, deletedAt: null, NOT: { id: user.id } },
      select: { id: true },
    });
    if (taken) throw new AppError("AUTH_EMAIL_IN_USE");

    const previousWasSynthetic = isSyntheticEmail(user.email);

    // One transaction, so the address a person signs in with and the address
    // LITRACK knows them by can never disagree (invariant I2). `setEmail`
    // throws AUTH_EMAIL_IN_USE if another identity already holds the address.
    await prismaFresh.$transaction(async (tx) => {
      await setEmail(user.authId, newEmail, tx);
      await tx.user.update({ where: { id: user.id }, data: { email: newEmail } });
    });

    await writeAudit({
      userId: user.id,
      schoolId: user.schoolId,
      action: AUDIT_ACTIONS.EMAIL_CHANGE,
      resource: "User",
      resourceId: user.id,
      metadata: { previousWasSynthetic },
    });

    revalidatePath(roleSecurityPath(user.role));

    return { ok: true };
  },
  { verb: "save your new email" }
);

/**
 * Email recovery for accounts with a real (non-synthetic) email.
 * Always returns the same success message (no account enumeration).
 */
export const requestPasswordReset = action(
  "requestPasswordReset",
  async (formData: FormData): Promise<{ ok: true }> => {
    assertAuthConfigured();

    const input = parseInput(forgotPasswordSchema, { email: formData.get("email") });

    const email = input.email.toLowerCase();
    const rate = await checkRateLimit(`password:forgot:${email}`, RECOVERY_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

    // Do not reveal whether the account exists. Skip reset for synthetic emails.
    if (!isSyntheticEmail(email)) {
      const existing = await prisma.user.findUnique({
        where: { email },
        select: { id: true, authId: true, schoolId: true, isActive: true, deletedAt: true },
      });
      if (existing && existing.isActive && !existing.deletedAt) {
        const withinCooldown = await hasRecentRecoveryToken(
          existing.authId,
          RECOVERY_TOKEN_COOLDOWN_MS
        );
        if (!withinCooldown) {
          try {
            await sendPasswordRecoveryEmail(email, resolveRequestOrigin(), existing.authId);
          } catch (error) {
            // The person must still see "sent" — telling them it failed would
            // tell a stranger the account exists. But a mail sender that has
            // stopped working is otherwise invisible to everyone, which is how
            // you get a week of "I never got the email" with nothing logged.
            reportError(
              new AppError("AUTH_EMAIL_SEND_FAILED", {
                cause: error,
                detail: "Password recovery email delivery failed",
                context: { reason: "reset_email_failed", schoolId: existing.schoolId },
              }),
              {
                route: "requestPasswordReset",
                userId: existing.id,
                schoolId: existing.schoolId,
              }
            );
          }
        }
        await writeAudit({
          userId: existing.id,
          schoolId: existing.schoolId,
          action: AUDIT_ACTIONS.PASSWORD_RESET_REQUEST,
          resource: "User",
          resourceId: existing.id,
        });
      }
    }

    return { ok: true };
  },
  { verb: "send the reset email" }
);

/** Expire the reset-token cookie with the attributes `/auth/confirm/verify` set it with. */
async function expireResetCookie(): Promise<void> {
  (await cookies()).set(RESET_COOKIE, "", {
    httpOnly: true,
    secure: authCookiesSecure(),
    sameSite: "lax",
    path: RESET_COOKIE_PATH,
    maxAge: 0,
  });
}

/**
 * Complete password recovery. The emailed token reaches here only as the
 * httpOnly `litrack_reset` cookie `/auth/confirm/verify` set (scoped to
 * `/auth`, which is where this action is posted), never in a URL.
 *
 * The token is used up in the same transaction that writes the new password,
 * so a link works exactly once and a failed save leaves it usable. Then the
 * person is signed in with the new password and sent to their role home.
 */
export const completePasswordReset = action(
  "completePasswordReset",
  async (formData: FormData): Promise<never> => {
    assertAuthConfigured();

    const input = parseInput(setPasswordSchema, {
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    });

    const token = (await cookies()).get(RESET_COOKIE)?.value;
    const live = await peekResetToken(token);
    // The link, not the password: sending them to type a new one again would
    // fail exactly the same way.
    if (!token || !live) throw new AppError("AUTH_RESET_LINK_EXPIRED");

    const rate = await checkRateLimit(`password:reset:${live.authId}`, PASSWORD_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

    // Outside the transaction: ~100 ms of bcrypt must not hold row locks.
    const hash = await hashPassword(input.password);
    const appUser = await prismaFresh.$transaction(async (tx) => {
      // Throws AUTH_RESET_LINK_EXPIRED unless this request is the one that
      // used the token up, so of two concurrent submits only one writes.
      const authId = await consumeResetToken(token, tx);
      await setPassword(authId, { hash }, tx);
      const row = await tx.user.findUnique({
        where: { authId },
        select: {
          id: true,
          email: true,
          role: true,
          schoolId: true,
          isActive: true,
          deletedAt: true,
        },
      });
      if (row) {
        await tx.user.update({
          where: { id: row.id },
          data: passwordChangeFields(row.role, input.password),
        });
      }
      return row;
    });

    await expireResetCookie();
    // Whoever held the old password (or a stolen cookie) is signed out.
    await revokeAllSessions(live.authId);

    if (!appUser) redirect("/login");

    await writeAudit({
      userId: appUser.id,
      schoolId: appUser.schoolId,
      action: AUDIT_ACTIONS.PASSWORD_CHANGE,
      resource: "User",
      resourceId: appUser.id,
      metadata: { reason: "password_reset" },
    });

    // Only an account that may use LITRACK is signed in; anyone else picks up
    // the usual explanation at the sign-in page. A failed automatic sign-in
    // is not a failed reset — the password is saved — so it lands there too.
    if (!appUser.isActive || appUser.deletedAt) redirect("/login");
    const signIn = await signInWithPassword(appUser.email, input.password);
    redirect(signIn.ok ? roleHomePath(appUser.role) : "/login");
  },
  { verb: "save your new password" }
);
