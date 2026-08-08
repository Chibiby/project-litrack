"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { prisma } from "@/lib/prisma";
import {
  schoolLoginSchema,
  adminLoginSchema,
  teacherLoginSchema,
  requestTeacherRegisterOtpSchema,
  verifyTeacherRegisterOtpSchema,
  setPasswordSchema,
  changePasswordSchema,
  changeEmailSchema,
  forgotPasswordSchema,
} from "@/lib/validators/auth.schema";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import {
  getSupabasePublicEnv,
  isSupabaseConfigured,
  SUPABASE_NOT_CONFIGURED_MESSAGE,
} from "@/lib/supabase/env";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireUser, roleHomePath, roleSecurityPath } from "@/lib/auth/session";
import { completeTeacherAuthAfterVerify } from "@/lib/auth/teacher-registration";
import {
  DECLINED_REGISTRATION_MESSAGE,
  DEACTIVATED_TEACHER_MESSAGE,
  isDeactivatedTeacher,
  isPendingTeacherAtSchool,
  registerConflictError,
} from "@/lib/auth/teacher-registration-helpers";

type ActionResult = { ok: true } | { ok: false; error: string };

const LOGIN_RATE = { limit: 10, windowMs: 5 * 60 * 1000 } as const;
const OTP_RATE = { limit: 10, windowMs: 5 * 60 * 1000 } as const;
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

function mapSupabaseAuthError(message: string | undefined, fallback: string): string {
  const msg = (message ?? "").toLowerCase();
  if (
    msg.includes("rate") ||
    msg.includes("too many") ||
    msg.includes("security purposes") ||
    msg.includes("after")
  ) {
    return "Too many attempts. Please try again later.";
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

  const rate = checkRateLimit(`login:school-head:${parsed.data.schoolId}`, LOGIN_RATE);
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

  redirect("/school-head");
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

  const rate = checkRateLimit(`login:teacher:${schoolId}:${email}`, LOGIN_RATE);
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
  redirect(teacher.approvalStatus === "PENDING" ? "/pending-approval" : "/teacher");
}

/**
 * Request a 6-digit email OTP for teacher account creation only.
 * Never redirects — always returns a result for the login form.
 */
export async function requestTeacherRegisterOtp(
  formData: FormData
): Promise<{ ok: true } | { ok: false; error: string }> {
  const missing = requireSupabaseConfigured();
  if (missing) return missing;

  const parsed = requestTeacherRegisterOtpSchema.safeParse({
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
  const { schoolId } = parsed.data;

  const rate = checkRateLimit(`otp:teacher:${schoolId}:${email}`, OTP_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const school = await assertActiveSchool(schoolId);
  if ("ok" in school && school.ok === false) return school;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && !existing.deletedAt) {
    return { ok: false, error: registerConflictError(existing, schoolId) };
  }

  // Use a non-cookie client so signInWithOtp does not write a PKCE code-verifier
  // cookie (SSR client would remount /login and wipe teacherStep OTP UI state).
  const env = getSupabasePublicEnv();
  if (!env.ok) {
    return { ok: false, error: SUPABASE_NOT_CONFIGURED_MESSAGE };
  }

  const supabase = createClient(env.url, env.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "implicit",
    },
  });

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true },
  });
  if (error) {
    return {
      ok: false,
      error: mapSupabaseAuthError(error.message, "Failed to send code. Please try again."),
    };
  }

  return { ok: true };
}

type TeacherRegisterNames = {
  firstName: string;
  middleName?: string;
  lastName: string;
};

/** Serialize concurrent teacher-register verifies per email (OTP is single-use). */
const teacherRegisterVerifyInflight = new Map<string, Promise<unknown>>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Finish teacher self-register after auth is established (OTP verify or recovery).
 * On success redirects (never returns).
 */
async function finishTeacherRegister(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  params: {
    authId: string;
    email: string;
    schoolId: string;
    names: TeacherRegisterNames;
  }
): Promise<{ ok: false; error: string }> {
  const result = await completeTeacherAuthAfterVerify({
    authId: params.authId,
    email: params.email,
    schoolId: params.schoolId,
    intent: "register",
    names: params.names,
  });

  if (!result.ok) {
    // Auth is already proven (OTP verify or password). If PENDING exists,
    // never toast failure / signOut — a peer create or post-create glitch
    // already succeeded for this email+school.
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
          console.error("[verifyTeacherRegisterOtp] authId link after pending recover:", err);
        }
      }
      redirect("/account/created");
    }

    if (result.signOut) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.error("[verifyTeacherRegisterOtp] signOut failed:", err);
      }
    }
    return { ok: false, error: result.error };
  }

  redirect(result.outcome === "approved" ? "/teacher" : "/account/created");
}

async function resolveTeacherRegisterAuthId(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  email: string,
  password: string
): Promise<string | null> {
  const {
    data: { user: sessionUser },
  } = await supabase.auth.getUser();

  if (sessionUser?.email?.toLowerCase() === email) {
    return sessionUser.id;
  }

  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (!signInError && signInData.user) {
    return signInData.user.id;
  }
  return null;
}

/**
 * When OTP verify fails, recover if a prior successful submit already set the
 * password / session and created (or can create) the PENDING teacher row.
 */
async function recoverTeacherRegisterAfterConsumedOtp(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  params: {
    email: string;
    schoolId: string;
    password: string;
    names: TeacherRegisterNames;
  }
): Promise<{ ok: false; error: string } | never> {
  const { email, schoolId, password, names } = params;

  let authId = await resolveTeacherRegisterAuthId(supabase, email, password);

  // Peer may have created PENDING but password cookies are still settling.
  if (!authId) {
    const pending = await prisma.user.findFirst({
      where: {
        email,
        schoolId,
        role: "TEACHER",
        approvalStatus: "PENDING",
        deletedAt: null,
      },
      select: { id: true },
    });
    if (pending) {
      for (let attempt = 0; attempt < 3 && !authId; attempt++) {
        await sleep(250 * (attempt + 1));
        authId = await resolveTeacherRegisterAuthId(supabase, email, password);
      }
    }
  }

  if (!authId) {
    return { ok: false, error: "Invalid or expired code." };
  }

  return finishTeacherRegister(supabase, { authId, email, schoolId, names });
}

/**
 * Verify teacher registration OTP, set password, create pending teacher row.
 * On success redirects (never returns); on failure returns an error.
 */
export async function verifyTeacherRegisterOtp(
  formData: FormData
): Promise<{ ok: false; error: string } | never> {
  const missing = requireSupabaseConfigured();
  if (missing) return missing;

  const parsed = verifyTeacherRegisterOtpSchema.safeParse({
    schoolId: formData.get("schoolId"),
    email: formData.get("email"),
    code: formData.get("code"),
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
  const { schoolId, code, password } = parsed.data;
  const names: TeacherRegisterNames = {
    firstName: parsed.data.firstName.trim(),
    middleName: parsed.data.middleName?.trim() || undefined,
    lastName: parsed.data.lastName.trim(),
  };

  const rate = checkRateLimit(`otp:verify:${schoolId}:${email}`, OTP_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const school = await assertActiveSchool(schoolId);
  if ("ok" in school && school.ok === false) return school;

  const inflightKey = `${schoolId}:${email}`;
  const peer = teacherRegisterVerifyInflight.get(inflightKey);
  if (peer) {
    await peer.then(
      () => undefined,
      () => undefined
    );
    const supabase = await createSupabaseServerClient();
    return recoverTeacherRegisterAfterConsumedOtp(supabase, {
      email,
      schoolId,
      password,
      names,
    });
  }

  const run = (async (): Promise<{ ok: false; error: string } | void> => {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });
    if (error || !data.user) {
      // OTP is single-use: a concurrent/retry submit often fails here after the
      // first submit already created the PENDING teacher — recover instead of toasting.
      return recoverTeacherRegisterAfterConsumedOtp(supabase, {
        email,
        schoolId,
        password,
        names,
      });
    }

    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) {
      try {
        await supabase.auth.signOut();
      } catch (err) {
        console.error("[verifyTeacherRegisterOtp] signOut after password fail:", err);
      }
      return {
        ok: false,
        error: mapSupabaseAuthError(
          passwordError.message,
          "Failed to set password. Please try again."
        ),
      };
    }

    return finishTeacherRegister(supabase, {
      authId: data.user.id,
      email,
      schoolId,
      names,
    });
  })();

  teacherRegisterVerifyInflight.set(inflightKey, run);
  try {
    return (await run) as { ok: false; error: string } | never;
  } finally {
    if (teacherRegisterVerifyInflight.get(inflightKey) === run) {
      teacherRegisterVerifyInflight.delete(inflightKey);
    }
  }
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

  const rate = checkRateLimit(`login:admin:${parsed.data.email.toLowerCase()}`, LOGIN_RATE);
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

  const rate = checkRateLimit(`password:set:${user.id}`, PASSWORD_RATE);
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

  const rate = checkRateLimit(`password:change:${user.id}`, PASSWORD_RATE);
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

  const rate = checkRateLimit(`email:change:${user.id}`, EMAIL_RATE);
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
  const rate = checkRateLimit(`password:forgot:${email}`, RECOVERY_RATE);
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

  const rate = checkRateLimit(`password:reset:${authUser.id}`, PASSWORD_RATE);
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
