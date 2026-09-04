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
import { isSupabaseConfigured, SUPABASE_NOT_CONFIGURED_MESSAGE } from "@/lib/supabase/env";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireUser, roleHomePath, roleSecurityPath } from "@/lib/auth/session";
import { completeTeacherAuthAfterVerify } from "@/lib/auth/teacher-registration";
import {
  warmAdminRoutes,
  warmSchoolHeadRoutes,
  warmTeacherRoutes,
} from "@/lib/auth/warm-routes";
import {
  DECLINED_REGISTRATION_MESSAGE,
  DEACTIVATED_TEACHER_MESSAGE,
  isDeactivatedTeacher,
  isPendingTeacherAtSchool,
  registerConflictError,
} from "@/lib/auth/teacher-registration-helpers";

type ActionResult = { ok: true } | { ok: false; error: string };

const LOGIN_RATE = { limit: 10, windowMs: 5 * 60 * 1000 } as const;
const REGISTER_RATE = { limit: 5, windowMs: 15 * 60 * 1000 } as const;
const RECOVERY_RATE = { limit: 5, windowMs: 15 * 60 * 1000 } as const;
const PASSWORD_RATE = { limit: 10, windowMs: 15 * 60 * 1000 } as const;
const EMAIL_RATE = { limit: 10, windowMs: 15 * 60 * 1000 } as const;

function requireSupabaseConfigured(): { ok: false; error: string } | null {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: SUPABASE_NOT_CONFIGURED_MESSAGE };
  }
  return null;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

/**
 * Turns a Supabase auth failure into something safe to show, and — just as
 * importantly — logs the one it was given.
 *
 * Every branch here used to collapse to a generic sentence with nothing
 * written anywhere, so "Failed to send code. Please try again." was a dead end:
 * it could equally mean signups are switched off for the project, the SMTP
 * sender is misconfigured, or the address was rejected, and no one could tell
 * which. `scope` names the caller so the server log says where it came from.
 *
 * The email is not logged. The message Supabase returns can be, because it
 * describes the project's own configuration rather than the person signing in.
 */
function mapSupabaseAuthError(
  message: string | undefined,
  fallback: string,
  scope = "auth"
): string {
  const msg = (message ?? "").toLowerCase();
  console.error(`[${scope}] supabase auth error:`, message ?? "(no message)");

  if (
    msg.includes("rate") ||
    msg.includes("too many") ||
    msg.includes("security purposes") ||
    msg.includes("after")
  ) {
    return "Too many attempts. Please try again later.";
  }
  // Supabase returns this when "Allow new users to sign up" is off for the
  // project. Nothing the person typed can fix it, so say so rather than
  // inviting them to retry forever.
  if (msg.includes("signup") && msg.includes("not allowed")) {
    return "New account sign-ups are currently disabled. Please contact your school head.";
  }
  // "Error sending magic link email" / "Error sending confirmation email" —
  // the project's SMTP sender failed or is over quota. Also nothing the person
  // can act on, but it is genuinely worth retrying.
  if (msg.includes("error sending") || msg.includes("smtp")) {
    return "We could not send the email right now. Please try again in a few minutes, or contact your school head if it keeps failing.";
  }
  if (msg.includes("invalid") && msg.includes("email")) {
    return "That email address was rejected. Please check it and try again.";
  }
  return fallback;
}

async function assertActiveSchool(
  schoolId: string
): Promise<{ id: string } | { ok: false; error: string }> {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, isActive: true, deletedAt: true },
  });
  if (!school || !school.isActive || school.deletedAt) {
    return { ok: false, error: "School not found or inactive" };
  }
  return { id: school.id };
}

/**
 * School Head login: school selection + password (activation credential or private password).
 * Sign-in uses the SH account's stored Prisma email (synthetic by default, or changed later).
 */
export async function loginSchoolHead(formData: FormData): Promise<ActionResult> {
  const missing = requireSupabaseConfigured();
  if (missing) return missing;

  const parsed = schoolLoginSchema.safeParse({
    schoolId: formData.get("schoolId"),
    role: "SCHOOL_HEAD",
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const rate = await checkRateLimit(`login:school-head:${parsed.data.schoolId}`, LOGIN_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const school = await prisma.school.findUnique({
    where: { id: parsed.data.schoolId },
    select: { id: true, isActive: true, deletedAt: true },
  });
  if (!school || !school.isActive || school.deletedAt) {
    return { ok: false, error: "School not found or inactive" };
  }

  const shUser = await prisma.user.findFirst({
    where: {
      role: "SCHOOL_HEAD",
      schoolId: school.id,
      deletedAt: null,
      isActive: true,
    },
    select: { id: true, email: true, isActive: true },
  });
  if (!shUser) {
    return { ok: false, error: "Login failed. Please contact your administrator." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: shUser.email,
    password: parsed.data.password,
  });
  if (error) {
    await writeAudit({
      userId: shUser.id,
      schoolId: school.id,
      action: AUDIT_ACTIONS.LOGIN_DENIED,
      resource: "User",
      resourceId: shUser.id,
      metadata: { role: "SCHOOL_HEAD", schoolId: school.id, reason: "incorrect_credentials" },
    });
    return { ok: false, error: "Login failed. Please contact your administrator." };
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

/**
 * Teacher login with email + password only (no OTP / codes).
 */
export async function loginTeacher(formData: FormData): Promise<ActionResult> {
  const missing = requireSupabaseConfigured();
  if (missing) return missing;

  const parsed = teacherLoginSchema.safeParse({
    schoolId: formData.get("schoolId"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const email = parsed.data.email.toLowerCase().trim();
  const { schoolId, password } = parsed.data;

  const rate = await checkRateLimit(`login:teacher:${schoolId}:${email}`, LOGIN_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const school = await assertActiveSchool(schoolId);
  if ("ok" in school && school.ok === false) return school;

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

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    await writeAudit({
      userId: teacher.id,
      schoolId,
      action: AUDIT_ACTIONS.LOGIN_DENIED,
      resource: "User",
      resourceId: teacher.id,
      metadata: { role: "TEACHER", schoolId, reason: "incorrect_credentials" },
    });
    return { ok: false, error: "Incorrect email or password." };
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
}

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
type TeacherRegisterResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string };

/** Success page for a teacher awaiting School Head approval. */
const REGISTER_PENDING_PATH = "/account/created";

const REGISTER_SIGN_IN_MESSAGE =
  "Your account was created. Please sign in with your email and password.";

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
  }
): Promise<TeacherRegisterResult> {
  const result = await completeTeacherAuthAfterVerify({
    authId: params.authId,
    email: params.email,
    schoolId: params.schoolId,
    intent: "register",
    names: params.names,
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
    return { ok: false, error: result.error };
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
): Promise<{ ok: true; authId: string } | { ok: false; error: string }> {
  const { email, password, schoolId } = params;

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (err) {
    console.error("[registerTeacher] admin client unavailable:", err);
    return {
      ok: false,
      error: "Account creation is temporarily unavailable. Please contact your School Head.",
    };
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role: "TEACHER", schoolId },
  });
  if (!error && data.user) {
    return { ok: true, authId: data.user.id };
  }

  const message = (error?.message ?? "").toLowerCase();
  const alreadyRegistered =
    message.includes("already registered") ||
    message.includes("already been registered") ||
    message.includes("already exists");

  if (!alreadyRegistered) {
    return {
      ok: false,
      error: mapSupabaseAuthError(
        error?.message,
        "Could not create your account. Please try again.",
        "registerTeacher"
      ),
    };
  }

  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError || !signInData.user) {
    return {
      ok: false,
      error:
        "That email already has an account. Sign in instead, or use Forgot password to reset it.",
    };
  }
  return { ok: true, authId: signInData.user.id };
}

/**
 * Teacher self-registration in a single step: names, email, password.
 *
 * There is no verification code. The account is created PENDING and the School
 * Head approves it before the teacher can use LITRACK; email is used only for
 * password recovery. Returns the destination on success so the client navigates
 * after the session cookies land, or an error message on failure.
 */
export async function registerTeacher(formData: FormData): Promise<TeacherRegisterResult> {
  const missing = requireSupabaseConfigured();
  if (missing) return missing;

  const parsed = teacherRegisterSchema.safeParse({
    schoolId: formData.get("schoolId"),
    email: formData.get("email"),
    firstName: formData.get("firstName") || undefined,
    middleName: formData.get("middleName") || undefined,
    lastName: formData.get("lastName") || undefined,
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const email = parsed.data.email.toLowerCase().trim();
  const { schoolId, password } = parsed.data;
  const names: TeacherRegisterNames = {
    firstName: parsed.data.firstName.trim(),
    middleName: parsed.data.middleName?.trim() || undefined,
    lastName: parsed.data.lastName.trim(),
  };

  const rate = await checkRateLimit(`register:teacher:${schoolId}:${email}`, REGISTER_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const school = await assertActiveSchool(schoolId);
  if ("ok" in school && school.ok === false) return school;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && !existing.deletedAt) {
    return { ok: false, error: registerConflictError(existing, schoolId) };
  }

  const supabase = await createSupabaseServerClient();
  const auth = await createOrAdoptTeacherAuthUser(supabase, { email, password, schoolId });
  if (!auth.ok) return auth;

  // Sign in so the browser holds a session for /account/created. If this fails
  // the auth user exists but no LITRACK row does yet — signing in and creating
  // the account again recovers it through the adopt path above.
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session || session.user.id !== auth.authId) {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      console.error("[registerTeacher] sign-in after create failed:", signInError.message);
      return { ok: false, error: REGISTER_SIGN_IN_MESSAGE };
    }
  }

  return finishTeacherRegister(supabase, { authId: auth.authId, email, schoolId, names });
}

export async function loginAdmin(formData: FormData): Promise<ActionResult> {
  const missing = requireSupabaseConfigured();
  if (missing) return missing;

  const parsed = adminLoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const rate = await checkRateLimit(`login:admin:${parsed.data.email.toLowerCase()}`, LOGIN_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error || !data.user) {
      await writeAudit({
        action: AUDIT_ACTIONS.LOGIN_DENIED,
        resource: "User",
        metadata: { role: "SUPER_ADMIN", reason: "incorrect_credentials" },
      });
      return { ok: false, error: "Incorrect credentials" };
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
      return { ok: false, error: "Not authorized" };
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
  } catch (err) {
    const message = err instanceof Error ? err.message : "Login failed";
    if (message.includes("SUPABASE") || message.includes("Missing NEXT_PUBLIC")) {
      return { ok: false, error: SUPABASE_NOT_CONFIGURED_MESSAGE };
    }
    if (
      message.includes("DATABASE") ||
      message.includes("Prisma") ||
      message.includes("Environment variable not found")
    ) {
      return {
        ok: false,
        error: "Database is not configured. Set DATABASE_URL on Vercel and run migrations/seed.",
      };
    }
    throw err;
  }
}

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
export async function setPasswordAction(formData: FormData): Promise<ActionResult> {
  const missing = requireSupabaseConfigured();
  if (missing) return missing;

  const user = await requireUser(undefined, true, { allowMustChangePassword: true });

  const rate = await checkRateLimit(`password:set:${user.id}`, PASSWORD_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const parsed = setPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: "Failed to update password. Please try again." };

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
    metadata: { reason: "set_password" },
  });

  redirect(roleHomePath(user.role));
}

/**
 * Voluntary password change — requires verifying the current password first.
 */
export async function changePasswordAction(formData: FormData): Promise<ActionResult> {
  const missing = requireSupabaseConfigured();
  if (missing) return missing;

  const user = await requireUser();

  const rate = await checkRateLimit(`password:change:${user.id}`, PASSWORD_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const supabase = await createSupabaseServerClient();
  const { error: verifyErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  });
  if (verifyErr) return { ok: false, error: "Current password is incorrect" };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: "Failed to update password. Please try again." };

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
    metadata: { reason: "change_password" },
  });

  return { ok: true };
}

/**
 * Change account email — re-auth with current password, then dual-write Auth + Prisma.
 */
export async function changeEmailAction(formData: FormData): Promise<ActionResult> {
  const missing = requireSupabaseConfigured();
  if (missing) return missing;

  const user = await requireUser();

  const rate = await checkRateLimit(`email:change:${user.id}`, EMAIL_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const parsed = changeEmailSchema.safeParse({
    newEmail: formData.get("newEmail"),
    confirmEmail: formData.get("confirmEmail"),
    currentPassword: formData.get("currentPassword"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const newEmail = parsed.data.newEmail.trim().toLowerCase();
  const currentEmail = user.email.trim().toLowerCase();
  if (newEmail === currentEmail) {
    return { ok: false, error: "New email must be different from your current email" };
  }

  const supabase = await createSupabaseServerClient();
  const { error: verifyErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  });
  if (verifyErr) return { ok: false, error: "Current password is incorrect" };

  const taken = await prisma.user.findFirst({
    where: {
      email: newEmail,
      deletedAt: null,
      NOT: { id: user.id },
    },
    select: { id: true },
  });
  if (taken) {
    return { ok: false, error: "That email is already in use." };
  }

  const previousWasSynthetic = isSyntheticEmail(user.email);
  const oldEmail = user.email;

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch {
    return { ok: false, error: "Email change is temporarily unavailable. Please try again later." };
  }

  const { error: authErr } = await admin.auth.admin.updateUserById(user.authId, {
    email: newEmail,
    email_confirm: true,
  });
  if (authErr) {
    return { ok: false, error: "Failed to update email. Please try again." };
  }

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { email: newEmail },
    });
  } catch {
    const { error: rollbackErr } = await admin.auth.admin.updateUserById(user.authId, {
      email: oldEmail,
      email_confirm: true,
    });
    if (rollbackErr) {
      return {
        ok: false,
        error:
          "Email was updated in authentication but failed to save locally. Please contact support.",
      };
    }
    return { ok: false, error: "Failed to update email. Please try again." };
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
}

/**
 * Email recovery for accounts with a real (non-synthetic) email.
 * Always returns the same success message (no account enumeration).
 */
export async function requestPasswordReset(formData: FormData): Promise<ActionResult> {
  const missing = requireSupabaseConfigured();
  if (missing) return missing;

  const parsed = forgotPasswordSchema.safeParse({
    email: formData.get("email"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid email address" };

  const email = parsed.data.email.toLowerCase();
  const rate = await checkRateLimit(`password:forgot:${email}`, RECOVERY_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  // Do not reveal whether the account exists. Skip reset for synthetic emails.
  if (!isSyntheticEmail(email)) {
    const existing = await prisma.user.findUnique({
      where: { email },
      select: { id: true, schoolId: true, isActive: true, deletedAt: true },
    });
    if (existing && existing.isActive && !existing.deletedAt) {
      const supabase = await createSupabaseServerClient();
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${appUrl()}/auth/reset`,
      });
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

/**
 * Complete password recovery after Supabase redirects to /auth/reset with a recovery session.
 */
export async function completePasswordReset(formData: FormData): Promise<ActionResult> {
  const missing = requireSupabaseConfigured();
  if (missing) return missing;

  const parsed = setPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) {
    return { ok: false, error: "Reset session expired. Please request a new link." };
  }

  const rate = await checkRateLimit(`password:reset:${authUser.id}`, PASSWORD_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: "Failed to update password. Please try again." };

  const appUser = await prisma.user.findUnique({ where: { authId: authUser.id } });
  if (appUser) {
    await prisma.user.update({
      where: { id: appUser.id },
      data: { mustChangePassword: false },
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
