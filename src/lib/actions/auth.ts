"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import {
  schoolLoginSchema,
  teacherLoginSchema,
  adminLoginSchema,
  teacherSetupSchema,
  setPasswordSchema,
  changePasswordSchema,
  forgotPasswordSchema,
} from "@/lib/validators/auth.schema";
import {
  schoolHeadSyntheticEmail,
  teacherSyntheticEmail,
  isSyntheticEmail,
} from "@/lib/auth/synthetic-email";
import { hashToken, findTeacherForInvite, inviteTokenStatus } from "@/lib/auth/invites";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  isSupabaseConfigured,
  SUPABASE_NOT_CONFIGURED_MESSAGE,
} from "@/lib/supabase/env";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireUser, roleHomePath } from "@/lib/auth/session";

type ActionResult = { ok: true } | { ok: false; error: string };

const LOGIN_RATE = { limit: 10, windowMs: 5 * 60 * 1000 } as const;
const INVITE_RATE = { limit: 10, windowMs: 5 * 60 * 1000 } as const;
const RECOVERY_RATE = { limit: 5, windowMs: 15 * 60 * 1000 } as const;
const PASSWORD_RATE = { limit: 10, windowMs: 15 * 60 * 1000 } as const;

function requireSupabaseConfigured(): ActionResult | null {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: SUPABASE_NOT_CONFIGURED_MESSAGE };
  }
  return null;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

/**
 * School Head login: school selection + password (activation credential or private password).
 * Does NOT treat School ID as a password — sign-in uses the SH synthetic email + entered password.
 */
export async function loginSchoolHead(formData: FormData): Promise<ActionResult> {
  const missing = requireSupabaseConfigured();
  if (missing) return missing;

  const parsed = schoolLoginSchema.safeParse({
    schoolId: formData.get("schoolId"),
    role: "SCHOOL_HEAD",
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const rate = checkRateLimit(`login:school-head:${parsed.data.schoolId}`, LOGIN_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const school = await prisma.school.findUnique({
    where: { id: parsed.data.schoolId },
    select: { id: true, schoolIdCode: true, isActive: true, deletedAt: true },
  });
  if (!school || !school.isActive || school.deletedAt) {
    return { ok: false, error: "School not found or inactive" };
  }

  const email = schoolHeadSyntheticEmail(school.schoolIdCode);

  const shUser = await prisma.user.findFirst({
    where: { email, role: "SCHOOL_HEAD", schoolId: school.id, deletedAt: null },
    select: { id: true, isActive: true },
  });
  if (!shUser || !shUser.isActive) {
    return { ok: false, error: "Login failed. Please contact your administrator." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
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
 * Teacher login: school + username + password.
 * Username maps to synthetic email via teacherSyntheticEmail().
 * mustChangePassword users are gated by requireUser → /account/set-password.
 */
export async function loginTeacher(formData: FormData): Promise<ActionResult> {
  const missing = requireSupabaseConfigured();
  if (missing) return missing;

  const parsed = teacherLoginSchema.safeParse({
    schoolId: formData.get("schoolId"),
    username: formData.get("username"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const username = parsed.data.username.trim().toLowerCase();
  const schoolId = parsed.data.schoolId;

  const rate = checkRateLimit(`login:teacher:${schoolId}:${username}`, LOGIN_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const syntheticEmail = teacherSyntheticEmail(username);

  const user = await prisma.user.findFirst({
    where: { email: syntheticEmail, role: "TEACHER", schoolId, deletedAt: null, isActive: true },
    select: { id: true },
  });
  if (!user) return { ok: false, error: "Incorrect username or password" };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: syntheticEmail,
    password: parsed.data.password,
  });
  if (error) {
    await writeAudit({
      userId: user.id,
      schoolId,
      action: AUDIT_ACTIONS.LOGIN_DENIED,
      resource: "User",
      resourceId: user.id,
      metadata: { role: "TEACHER", schoolId, reason: "incorrect_credentials" },
    });
    return { ok: false, error: "Incorrect username or password" };
  }

  await writeAudit({
    userId: user.id,
    schoolId,
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    resource: "User",
    resourceId: user.id,
    metadata: { role: "TEACHER", schoolId },
  });

  redirect("/teacher");
}

export async function loginAdmin(formData: FormData): Promise<ActionResult> {
  const missing = requireSupabaseConfigured();
  if (missing) return missing;

  const parsed = adminLoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid input" };

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
 * Teacher invite acceptance: sets password on the EXISTING user (created at invite time),
 * clears mustChangePassword, marks invite consumed, signs in.
 *
 * Token expiry only blocks this link path — credential login may still work; see inviteTokenStatus.
 */
export async function acceptTeacherInvite(formData: FormData): Promise<ActionResult> {
  const missing = requireSupabaseConfigured();
  if (missing) return missing;

  const parsed = teacherSetupSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const rate = checkRateLimit(`invite:accept:${hashToken(parsed.data.token)}`, INVITE_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const tokenHash = hashToken(parsed.data.token);
  const invite = await prisma.teacherInvite.findUnique({
    where: { tokenHash },
  });

  if (!invite || inviteTokenStatus(invite) !== "pending") {
    return { ok: false, error: "This invite link is invalid or expired" };
  }

  const teacher = await findTeacherForInvite(invite, parsed.data.token);
  if (!teacher || !teacher.isActive) {
    return { ok: false, error: "This invite link is invalid or expired" };
  }

  const admin = createSupabaseAdminClient();
  const { error: updateErr } = await admin.auth.admin.updateUserById(teacher.authId, {
    password: parsed.data.password,
    app_metadata: { role: "TEACHER", schoolId: invite.schoolId },
  });
  if (updateErr) {
    return { ok: false, error: "Failed to set password. Please try again." };
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: teacher.id },
      data: { mustChangePassword: false },
    }),
    prisma.teacherInvite.update({
      where: { id: invite.id },
      data: { consumedAt: new Date() },
    }),
  ]);

  await writeAudit({
    userId: teacher.id,
    schoolId: invite.schoolId,
    action: AUDIT_ACTIONS.TEACHER_INVITE_ACCEPT,
    resource: "TeacherInvite",
    resourceId: invite.id,
    metadata: { schoolId: invite.schoolId, userId: teacher.id },
  });

  const supabase = await createSupabaseServerClient();
  const { error: signInErr } = await supabase.auth.signInWithPassword({
    email: teacher.email,
    password: parsed.data.password,
  });
  if (signInErr) {
    return { ok: false, error: "Password set, but sign-in failed. Please log in with your username." };
  }

  redirect("/teacher");
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
