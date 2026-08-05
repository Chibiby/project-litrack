"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { schoolLoginSchema, adminLoginSchema, teacherSetupSchema } from "@/lib/validators/auth.schema";
import { schoolHeadSyntheticEmail, teacherSyntheticEmail } from "@/lib/auth/synthetic-email";
import { hashToken } from "@/lib/auth/invites";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  isSupabaseConfigured,
  SUPABASE_NOT_CONFIGURED_MESSAGE,
} from "@/lib/supabase/env";
import {
  findUserByAuthIdViaPostgrest,
  isPrismaConnectionError,
  isUsableAppUser,
} from "@/lib/auth/app-user";

type ActionResult = { ok: true } | { ok: false; error: string };

function requireSupabaseConfigured(): ActionResult | null {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: SUPABASE_NOT_CONFIGURED_MESSAGE };
  }
  return null;
}

/**
 * School Head login: provides School name, password = School ID code.
 * Maps to a synthetic email; Supabase password = schoolIdCode.
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

  try {
    const school = await prisma.school.findUnique({
      where: { id: parsed.data.schoolId },
      select: { id: true, name: true, schoolIdCode: true, isActive: true, deletedAt: true },
    });
    if (!school || !school.isActive || school.deletedAt) {
      return { ok: false, error: "School not found or inactive" };
    }
    if (school.schoolIdCode !== parsed.data.password) {
      return { ok: false, error: "Incorrect School ID" };
    }

    const supabase = await createSupabaseServerClient();
    const email = schoolHeadSyntheticEmail(school.schoolIdCode);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password: school.schoolIdCode,
    });
    if (error) return { ok: false, error: "Login failed. Please contact your administrator." };

    redirect("/school-head");
  } catch (err) {
    const digest =
      typeof err === "object" && err !== null && "digest" in err
        ? String((err as { digest?: unknown }).digest)
        : "";
    if (digest.includes("NEXT_REDIRECT")) throw err;
    if (isPrismaConnectionError(err)) {
      return { ok: false, error: "Service temporarily unavailable. Please try again later." };
    }
    throw err;
  }
}

/**
 * Teacher login: select School, then enter username + password.
 * Username maps to synthetic email `<username>@school.local` (same as create/invite-accept).
 */
export async function loginTeacher(formData: FormData): Promise<ActionResult> {
  const missing = requireSupabaseConfigured();
  if (missing) return missing;

  const schoolId = String(formData.get("schoolId") ?? "");
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!schoolId || !username || !password) return { ok: false, error: "All fields required" };

  const syntheticEmail = teacherSyntheticEmail(username);

  try {
    const school = await prisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, isActive: true, deletedAt: true },
    });
    if (!school || !school.isActive || school.deletedAt) {
      return { ok: false, error: "School not found or inactive" };
    }

    const user = await prisma.user.findFirst({
      where: { email: syntheticEmail, role: "TEACHER", schoolId, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!user) return { ok: false, error: "Teacher not found in this school" };

    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email: syntheticEmail, password });
    if (error) return { ok: false, error: "Incorrect username or password" };

    redirect("/teacher");
  } catch (err) {
    const digest =
      typeof err === "object" && err !== null && "digest" in err
        ? String((err as { digest?: unknown }).digest)
        : "";
    if (digest.includes("NEXT_REDIRECT")) throw err;
    if (isPrismaConnectionError(err)) {
      return { ok: false, error: "Service temporarily unavailable. Please try again later." };
    }
    throw err;
  }
}

export async function loginAdmin(formData: FormData): Promise<ActionResult> {
  const missing = requireSupabaseConfigured();
  if (missing) return missing;

  const parsed = adminLoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error || !data.user) return { ok: false, error: "Incorrect credentials" };

    // Require a public."User" / Prisma row — never authorize from JWT claims alone.
    // PostgREST path covers no-DATABASE_URL; Prisma is fallback when PostgREST misses.
    let authorized = false;

    const { user: restUser } = await findUserByAuthIdViaPostgrest(data.user.id, supabase);
    if (restUser) {
      authorized =
        restUser.role === "SUPER_ADMIN" && isUsableAppUser(restUser);
    } else {
      try {
        const prismaUser = await prisma.user.findUnique({ where: { authId: data.user.id } });
        authorized =
          !!prismaUser &&
          prismaUser.role === "SUPER_ADMIN" &&
          isUsableAppUser(prismaUser);
      } catch (dbErr) {
        if (!isPrismaConnectionError(dbErr)) throw dbErr;
        authorized = false;
      }
    }

    if (!authorized) {
      await supabase.auth.signOut();
      return { ok: false, error: "Not authorized" };
    }

    redirect("/admin");
  } catch (err) {
    // next/navigation redirect() throws; must not be turned into an ActionResult
    const digest =
      typeof err === "object" && err !== null && "digest" in err
        ? String((err as { digest?: unknown }).digest)
        : "";
    if (digest.includes("NEXT_REDIRECT")) throw err;

    const message = err instanceof Error ? err.message : String(err ?? "Login failed");
    if (message.includes("SUPABASE") || message.includes("Missing NEXT_PUBLIC")) {
      return { ok: false, error: SUPABASE_NOT_CONFIGURED_MESSAGE };
    }
    if (isPrismaConnectionError(err)) {
      return { ok: false, error: "Login failed. Please try again." };
    }
    throw err;
  }
}

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Teacher invite acceptance: looks up TeacherInvite by tokenHash, creates a
 * Supabase auth user with synthetic email (same as createTeacherDirect / loginTeacher),
 * creates the User row, marks the invite consumed, and signs the user in.
 */
export async function acceptTeacherInvite(formData: FormData): Promise<ActionResult> {
  const missing = requireSupabaseConfigured();
  if (missing) return missing;

  const parsed = teacherSetupSchema.safeParse({
    token: formData.get("token"),
    username: formData.get("username"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  let invite;
  try {
    const tokenHash = hashToken(parsed.data.token);
    invite = await prisma.teacherInvite.findUnique({
      where: { tokenHash },
      include: { school: true, gradeLevel: true },
    });
  } catch (err) {
    if (isPrismaConnectionError(err)) {
      return { ok: false, error: "Service temporarily unavailable. Please try again later." };
    }
    throw err;
  }

  if (!invite || invite.consumedAt || invite.expiresAt < new Date()) {
    return { ok: false, error: "This invite link is invalid or expired" };
  }
  if (!invite.school.isActive || invite.school.deletedAt) {
    return { ok: false, error: "This school is no longer active" };
  }

  const username = parsed.data.username.trim().toLowerCase();
  const syntheticEmail = teacherSyntheticEmail(username);

  const existing = await prisma.user.findUnique({ where: { email: syntheticEmail } });
  if (existing) {
    return { ok: false, error: "That username is already taken. Choose another." };
  }

  const admin = createSupabaseAdminClient();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: syntheticEmail,
    password: parsed.data.password,
    email_confirm: true,
    app_metadata: { role: "TEACHER", schoolId: invite.schoolId },
    user_metadata: { username, inviteEmail: invite.email },
  });
  if (createErr || !created.user) {
    console.error("[acceptTeacherInvite] auth createUser failed:", createErr);
    return { ok: false, error: "Failed to create account. Please try again." };
  }

  const authUserId = created.user.id;
  const fullName = [invite.firstName, invite.middleName, invite.lastName].filter(Boolean).join(" ");

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          authId: authUserId,
          email: syntheticEmail,
          role: "TEACHER",
          schoolId: invite.schoolId,
          firstName: invite.firstName,
          middleName: invite.middleName,
          lastName: invite.lastName,
          fullName,
          isActive: true,
          profileCompleted: false,
          ...(invite.gradeLevelId
            ? { taughtGrades: { connect: { id: invite.gradeLevelId } } }
            : {}),
        },
      });
      await tx.teacherInvite.update({
        where: { id: invite.id },
        data: { consumedAt: new Date() },
      });
    });
  } catch (err) {
    console.error("[acceptTeacherInvite] prisma failed; deleting auth user:", err);
    try {
      await admin.auth.admin.deleteUser(authUserId);
    } catch (cleanupErr) {
      console.error("[acceptTeacherInvite] auth cleanup failed:", cleanupErr);
    }
    if (isPrismaConnectionError(err)) {
      return { ok: false, error: "Service temporarily unavailable. Please try again later." };
    }
    return { ok: false, error: "Failed to create account. Please try again." };
  }

  const supabase = await createSupabaseServerClient();
  await supabase.auth.signInWithPassword({
    email: syntheticEmail,
    password: parsed.data.password,
  });

  redirect("/teacher");
}
