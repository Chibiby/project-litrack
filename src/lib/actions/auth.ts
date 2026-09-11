"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { prisma } from "@/lib/prisma";
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
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { action } from "@/lib/errors/action";
import { AppError, tooManyAttempts } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { loginFailureReasonFor, mapSupabaseAuthError } from "@/lib/errors/supabase";
import { reportError } from "@/lib/errors/report";
import type { ActionFailure } from "@/lib/errors/result";
import { assertSupabaseConfigured, requireActiveSchool, LOGIN_RATE } from "@/lib/auth/login-gates";
import { assertLookupAllowed, recordFailedLookup } from "@/lib/auth/lookup-throttle";
import { requireUser, roleHomePath, roleSecurityPath } from "@/lib/auth/session";
import { completeTeacherAuthAfterVerify } from "@/lib/auth/teacher-registration";
import {
  warmAdminRoutes,
  warmSchoolHeadRoutes,
  warmTeacherRoutes,
} from "@/lib/auth/warm-routes";
import {
  isDeactivatedTeacher,
  isPendingTeacherAtSchool,
  registerConflictCode,
} from "@/lib/auth/teacher-registration-helpers";

const REGISTER_RATE = { limit: 5, windowMs: 15 * 60 * 1000 } as const;
const RECOVERY_RATE = { limit: 5, windowMs: 15 * 60 * 1000 } as const;
const PASSWORD_RATE = { limit: 10, windowMs: 15 * 60 * 1000 } as const;
const EMAIL_RATE = { limit: 10, windowMs: 15 * 60 * 1000 } as const;

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

/**
 * School Head login: school selection + password (activation credential or private password).
 * Sign-in uses the SH account's stored Prisma email (synthetic by default, or changed later).
 */
export const loginSchoolHead = action(
  "loginSchoolHead",
  async (formData: FormData): Promise<never> => {
    assertSupabaseConfigured();

    const input = parseInput(schoolLoginSchema, {
      schoolId: formData.get("schoolId"),
      role: "SCHOOL_HEAD",
      password: formData.get("password"),
    });

    const rate = await checkRateLimit(`login:school-head:${input.schoolId}`, LOGIN_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

    const school = await requireActiveSchool(input.schoolId);

    const shUser = await prisma.user.findFirst({
      where: {
        role: "SCHOOL_HEAD",
        schoolId: school.id,
        deletedAt: null,
        isActive: true,
      },
      select: { id: true, email: true, isActive: true },
      // Must match `findSchoolHead` in ./school-accounts, which the Super Admin
      // reset targets. Unordered, a school with two head rows could authenticate
      // against one account while the admin resets the other — and the reset
      // would look like it did nothing.
      orderBy: { createdAt: "asc" },
    });
    if (!shUser) {
      throw new AppError("AUTH_NO_SCHOOL_HEAD_ACCOUNT", {
        detail: `School ${school.id} has no active School Head account`,
        context: { schoolId: school.id, reason: "no_school_head" },
      });
    }

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: shUser.email,
      password: input.password,
    });
    if (error) {
      // Once the school is chosen and the account exists, a wrong password is a
      // wrong password — and this used to say "contact your administrator",
      // which is what sent schools off resetting credentials that were fine.
      const code = mapSupabaseAuthError(error, "server");
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
      throw new AppError(code, { cause: error, context: { schoolId: school.id } });
    }

    await writeAudit({
      userId: shUser.id,
      schoolId: school.id,
      action: AUDIT_ACTIONS.LOGIN_SUCCESS,
      resource: "User",
      resourceId: shUser.id,
      metadata: { role: "SCHOOL_HEAD", schoolId: school.id },
    });

    await warmSchoolHeadRoutes(school.id);

    redirect(SCHOOL_HEAD_ROUTES.dashboard);
  }
);

/**
 * Teacher login with email + password only (no OTP / codes).
 */
export const loginTeacher = action("loginTeacher", async (formData: FormData): Promise<never> => {
  assertSupabaseConfigured();

  const input = parseInput(teacherLoginSchema, {
    schoolId: formData.get("schoolId"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  const email = input.email.toLowerCase().trim();
  const { schoolId, password } = input;

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

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const code = mapSupabaseAuthError(error, "server");
    await writeAudit({
      userId: teacher.id,
      schoolId,
      action: AUDIT_ACTIONS.LOGIN_DENIED,
      resource: "User",
      resourceId: teacher.id,
      metadata: { role: "TEACHER", schoolId, reason: loginFailureReasonFor(code) },
    });
    throw new AppError(code, { cause: error, context: { schoolId } });
  }

  await writeAudit({
    userId: teacher.id,
    schoolId,
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    resource: "User",
    resourceId: teacher.id,
    metadata: { role: "TEACHER", schoolId, method: "password" },
  });

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
});

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
 * Finish teacher self-register once the Supabase session exists.
 * Returns the page the client should navigate to on success.
 */
async function finishTeacherRegister(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  params: {
    authId: string;
    email: string;
    schoolId: string;
    names: TeacherRegisterNames;
    isAralVolunteer: boolean;
  }
): Promise<{ ok: true; redirectTo: string }> {
  const result = await completeTeacherAuthAfterVerify({
    authId: params.authId,
    email: params.email,
    schoolId: params.schoolId,
    intent: "register",
    names: params.names,
    isAralVolunteer: params.isAralVolunteer,
  });

  if (!result.ok) {
    // Auth is already proven. If PENDING exists, never toast failure / signOut
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

    if (result.signOut) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.error("[registerTeacher] signOut failed:", err);
      }
    }
    // An AppError, carried up so the wrapper answers with it.
    throw result.error;
  }

  return {
    ok: true,
    redirectTo: result.outcome === "approved" ? "/teacher" : REGISTER_PENDING_PATH,
  };
}

/**
 * Create the Supabase auth user for a self-registering teacher with the email
 * already confirmed: account creation no longer proves the address with a
 * one-time code — School Head approval is the gate, and email is kept only for
 * password recovery.
 *
 * An auth user can already exist without a LITRACK row (the Prisma conflict
 * check above ran first): that is an abandoned earlier attempt, so adopt it
 * when the same password signs in rather than dead-ending the teacher.
 */
async function createOrAdoptTeacherAuthUser(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  params: { email: string; password: string; schoolId: string }
): Promise<string> {
  const { email, password, schoolId } = params;

  // Throws CONFIG_MISSING when the service-role key is absent or wrong, which
  // the wrapper turns into "not set up yet" plus a reference — where the old
  // "temporarily unavailable" implied waiting would fix it.
  const admin = createSupabaseAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: "TEACHER", schoolId },
  });
  if (!error && data.user) return data.user.id;

  const message = (error?.message ?? "").toLowerCase();
  const alreadyRegistered =
    message.includes("already registered") ||
    message.includes("already been registered") ||
    message.includes("already exists");

  if (!alreadyRegistered) {
    throw new AppError(mapSupabaseAuthError(error, "server"), { cause: error ?? undefined });
  }

  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signInData.user) {
    throw new AppError("AUTH_ACCOUNT_EXISTS_SIGN_IN", { cause: signInError ?? undefined });
  }
  return signInData.user.id;
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
    assertSupabaseConfigured();

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

    const supabase = await createSupabaseServerClient();
    const authId = await createOrAdoptTeacherAuthUser(supabase, { email, password, schoolId });

  // Sign in so the browser holds a session for /account/created. If this fails
  // the auth user exists but no LITRACK row does yet — signing in and creating
  // the account again recovers it through the adopt path above.
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session || session.user.id !== authId) {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        // The account exists; only the automatic sign-in failed. Telling them to
        // sign in is the one instruction that actually works here.
        throw new AppError("AUTH_REGISTERED_SIGN_IN", { cause: signInError });
      }
    }

    return finishTeacherRegister(supabase, {
      authId,
      email,
      schoolId,
      names,
      isAralVolunteer: input.isAralVolunteer,
    });
  },
  { verb: "create your account" }
);

/**
 * Super Admin login: username + password.
 *
 * The console signs in by handle rather than by email, but Supabase Auth only
 * authenticates on an address — so the handle is resolved against
 * `User.username` here and the row's `email` is what actually reaches Supabase.
 * Password recovery is unaffected and still runs entirely off that email.
 */
export const loginAdmin = action("loginAdmin", async (formData: FormData): Promise<never> => {
  assertSupabaseConfigured();

  const { username, password } = parseInput(adminLoginSchema, {
    username: formData.get("username"),
    password: formData.get("password"),
  });

  const rate = await checkRateLimit(`login:admin:${username}`, LOGIN_RATE);
  if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

  {
    // Supabase Auth authenticates on an email address, so the handle has to be
    // resolved to one before we can hand anything to `signInWithPassword`.
    //
    // Scoping the lookup to an active, non-deleted SUPER_ADMIN is the point of
    // doing it here rather than after sign-in: a handle that once belonged to a
    // revoked or lower-privileged account never reaches Supabase at all, so a
    // stale username cannot be used to probe for a live password.
    const account = await prisma.user.findFirst({
      where: {
        username,
        role: "SUPER_ADMIN",
        isActive: true,
        deletedAt: null,
      },
      select: { id: true, email: true },
    });
    if (!account) {
      await writeAudit({
        action: AUDIT_ACTIONS.LOGIN_DENIED,
        resource: "User",
        // The username itself is deliberately not logged — an audit row for a
        // failed attempt would otherwise record whatever a stranger typed.
        metadata: { role: "SUPER_ADMIN", reason: "unknown_username" },
      });
      // Identical to the wrong-password message below, so the field cannot be
      // used to enumerate which handles exist. This is the one login where the
      // generic message is deliberate: these are the highest-value accounts in
      // the system, and unlike a teacher there is no legitimate "did I type my
      // address wrong?" confusion to resolve.
      throw new AppError("AUTH_INCORRECT_CREDENTIALS");
    }

    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: account.email,
      password,
    });
    if (error || !data.user) {
      const mapped = error ? mapSupabaseAuthError(error, "server") : "AUTH_INCORRECT_PASSWORD";
      await writeAudit({
        userId: account.id,
        action: AUDIT_ACTIONS.LOGIN_DENIED,
        resource: "User",
        resourceId: account.id,
        metadata: { role: "SUPER_ADMIN", reason: loginFailureReasonFor(mapped) },
      });
      // Collapsed to the same message as an unknown handle — but only for the
      // credential case. A rate limit or an outage still says what it is.
      throw new AppError(
        mapped === "AUTH_INCORRECT_PASSWORD" ? "AUTH_INCORRECT_CREDENTIALS" : mapped,
        { cause: error ?? undefined }
      );
    }

    const user = await prisma.user.findUnique({ where: { authId: data.user.id } });
    if (!user || user.role !== "SUPER_ADMIN" || !user.isActive || user.deletedAt) {
      await supabase.auth.signOut();
      await writeAudit({
        userId: user?.id,
        action: AUDIT_ACTIONS.LOGIN_DENIED,
        resource: "User",
        resourceId: user?.id,
        metadata: { role: user?.role ?? "UNKNOWN", reason: "not_authorized" },
      });
      throw new AppError("AUTH_FORBIDDEN", {
        params: { what: "the admin console" },
        detail: `Signed in, but the account is not an active Super Admin (role ${user?.role ?? "none"})`,
        context: { reason: "not_super_admin" },
      });
    }

    await writeAudit({
      userId: user.id,
      action: AUDIT_ACTIONS.LOGIN_SUCCESS,
      resource: "User",
      resourceId: user.id,
      metadata: { role: "SUPER_ADMIN" },
    });

    await warmAdminRoutes();

    redirect("/admin");
  }
  // The try/catch that used to live here sniffed error messages for "SUPABASE",
  // "Prisma" and "Environment variable not found", then told an anonymous
  // visitor to set DATABASE_URL on Vercel. Both configuration failures now
  // throw CONFIG_MISSING from where they happen, and the wrapper gives the
  // person a reference while the variable names go to the error record.
});

/**
 * Deliberately NOT wrapped by `action()`.
 *
 * This is passed straight to `<form action={logoutAction}>`, whose signature
 * requires `Promise<void>` — and a form action has no way to read a returned
 * result anyway, so the wrapper would add a type error and nothing else. It
 * always redirects; anything that escapes is recorded by `onRequestError`.
 */
export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  let appUserId: string | null = null;
  let schoolId: string | null = null;
  if (authUser) {
    const row = await prisma.user.findUnique({
      where: { authId: authUser.id },
      select: { id: true, schoolId: true },
    });
    appUserId = row?.id ?? null;
    schoolId = row?.schoolId ?? null;
  }

  await supabase.auth.signOut();
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
 * Forced first-login / activation password change (current session).
 */
export const setPasswordAction = action(
  "setPasswordAction",
  async (formData: FormData): Promise<never> => {
    assertSupabaseConfigured();

    const user = await requireUser(undefined, true, { allowMustChangePassword: true });

    const rate = await checkRateLimit(`password:set:${user.id}`, PASSWORD_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

    const input = parseInput(setPasswordSchema, {
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    });

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.updateUser({ password: input.password });
    // A reused or policy-rejected password fails again on the next attempt, so
    // "please try again" was advice that could not work.
    if (error) throw new AppError(mapSupabaseAuthError(error, "server"), { cause: error });

  await prisma.user.update({
    where: { id: user.id },
    data: { mustChangePassword: false, passwordIsSchoolId: false },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.PASSWORD_CHANGE,
    resource: "User",
    resourceId: user.id,
      metadata: { reason: "set_password" },
    });

    redirect(roleHomePath(user.role));
  }
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
export const skipPasswordChange = action("skipPasswordChange", async (): Promise<never> => {
  const user = await requireUser(undefined, true, { allowMustChangePassword: true });

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
});

/**
 * Voluntary password change — requires verifying the current password first.
 */
export const changePasswordAction = action(
  "changePasswordAction",
  async (formData: FormData): Promise<{ ok: true }> => {
    assertSupabaseConfigured();

    const user = await requireUser();

    const rate = await checkRateLimit(`password:change:${user.id}`, PASSWORD_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

    const input = parseInput(changePasswordSchema, {
      currentPassword: formData.get("currentPassword"),
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    });

    const supabase = await createSupabaseServerClient();
    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: input.currentPassword,
    });
    if (verifyErr) {
      // A 429 here means Supabase declined to check the password at all. Saying
      // "incorrect" would send the person off to reset a password that is fine.
      const code = mapSupabaseAuthError(verifyErr, "server");
      throw new AppError(
        code === "AUTH_INCORRECT_PASSWORD" ? "AUTH_CURRENT_PASSWORD_INCORRECT" : code,
        { cause: verifyErr }
      );
    }

    const { error } = await supabase.auth.updateUser({ password: input.password });
    if (error) throw new AppError(mapSupabaseAuthError(error, "server"), { cause: error });

    await prisma.user.update({
      where: { id: user.id },
      data: { mustChangePassword: false, passwordIsSchoolId: false },
    });

    await writeAudit({
      userId: user.id,
      schoolId: user.schoolId,
      action: AUDIT_ACTIONS.PASSWORD_CHANGE,
      resource: "User",
      resourceId: user.id,
      metadata: { reason: "change_password" },
    });

    return { ok: true };
  }
);

/**
 * Change account email — re-auth with current password, then dual-write Auth + Prisma.
 */
export const changeEmailAction = action(
  "changeEmailAction",
  async (formData: FormData): Promise<{ ok: true }> => {
    assertSupabaseConfigured();

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

    const supabase = await createSupabaseServerClient();
    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: input.currentPassword,
    });
    if (verifyErr) {
      const code = mapSupabaseAuthError(verifyErr, "server");
      throw new AppError(
        code === "AUTH_INCORRECT_PASSWORD" ? "AUTH_CURRENT_PASSWORD_INCORRECT" : code,
        { cause: verifyErr }
      );
    }

    const taken = await prisma.user.findFirst({
      where: { email: newEmail, deletedAt: null, NOT: { id: user.id } },
      select: { id: true },
    });
    if (taken) throw new AppError("AUTH_EMAIL_IN_USE");

    const previousWasSynthetic = isSyntheticEmail(user.email);
    const oldEmail = user.email;

    // Throws CONFIG_MISSING when the service-role key is absent, which the
    // wrapper answers with a reference — the old "temporarily unavailable"
    // implied waiting would fix a permanent misconfiguration.
    const admin = createSupabaseAdminClient();

    const { error: authErr } = await admin.auth.admin.updateUserById(user.authId, {
      email: newEmail,
      email_confirm: true,
    });
    if (authErr) throw new AppError(mapSupabaseAuthError(authErr, "server"), { cause: authErr });

    try {
      await prisma.user.update({ where: { id: user.id }, data: { email: newEmail } });
    } catch (dbErr) {
      // Put the address back, or the person signs in with an address LITRACK
      // does not know. If even that fails, the two systems disagree about who
      // this account is — the one failure here that must page a human, because
      // no amount of retrying by the user can reconcile them.
      const { error: rollbackErr } = await admin.auth.admin.updateUserById(user.authId, {
        email: oldEmail,
        email_confirm: true,
      });
      if (rollbackErr) {
        throw new AppError("AUTH_EMAIL_PARTIAL_UPDATE", {
          cause: dbErr,
          detail: `Auth email changed to the new address but the LITRACK row still holds the old one, and the rollback failed: ${rollbackErr.message}`,
          context: { reason: "email_rollback_failed" },
        });
      }
      throw dbErr;
    }

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
    assertSupabaseConfigured();

    const input = parseInput(forgotPasswordSchema, { email: formData.get("email") });

    const email = input.email.toLowerCase();
    const rate = await checkRateLimit(`password:forgot:${email}`, RECOVERY_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

    // Do not reveal whether the account exists. Skip reset for synthetic emails.
    if (!isSyntheticEmail(email)) {
      const existing = await prisma.user.findUnique({
        where: { email },
        select: { id: true, schoolId: true, isActive: true, deletedAt: true },
      });
      if (existing && existing.isActive && !existing.deletedAt) {
        const supabase = await createSupabaseServerClient();
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${appUrl()}/auth/reset`,
        });
        if (error) {
          // The person must still see "sent" — telling them it failed would
          // tell a stranger the account exists. But a mail sender that has
          // stopped working is otherwise invisible to everyone, which is how
          // you get a week of "I never got the email" with nothing logged.
          reportError(
            new AppError("AUTH_EMAIL_SEND_FAILED", {
              cause: error,
              detail: `resetPasswordForEmail failed: ${error.message}`,
              context: { reason: "reset_email_failed", schoolId: existing.schoolId },
            }),
            {
              route: "requestPasswordReset",
              userId: existing.id,
              schoolId: existing.schoolId,
            }
          );
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
  }
);

/**
 * Complete password recovery after Supabase redirects to /auth/reset with a recovery session.
 */
export const completePasswordReset = action(
  "completePasswordReset",
  async (formData: FormData): Promise<never> => {
    assertSupabaseConfigured();

    const input = parseInput(setPasswordSchema, {
      password: formData.get("password"),
      confirmPassword: formData.get("confirmPassword"),
    });

    const supabase = await createSupabaseServerClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    // The link, not the password: sending them to type a new one again would
    // fail exactly the same way.
    if (!authUser) throw new AppError("AUTH_RESET_LINK_EXPIRED");

    const rate = await checkRateLimit(`password:reset:${authUser.id}`, PASSWORD_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs);

    const { error } = await supabase.auth.updateUser({ password: input.password });
    if (error) throw new AppError(mapSupabaseAuthError(error, "server"), { cause: error });

    const appUser = await prisma.user.findUnique({ where: { authId: authUser.id } });
  if (appUser) {
    await prisma.user.update({
      where: { id: appUser.id },
      data: { mustChangePassword: false, passwordIsSchoolId: false },
    });
    await writeAudit({
      userId: appUser.id,
      schoolId: appUser.schoolId,
      action: AUDIT_ACTIONS.PASSWORD_CHANGE,
      resource: "User",
      resourceId: appUser.id,
        metadata: { reason: "password_reset" },
      });
      redirect(roleHomePath(appUser.role));
    }

    redirect("/login");
  }
);
