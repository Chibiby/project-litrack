"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { schoolLoginSchema, adminLoginSchema, teacherSetupSchema } from "@/lib/validators/auth.schema";
import { schoolHeadSyntheticEmail } from "@/lib/auth/synthetic-email";
import { hashToken } from "@/lib/auth/invites";
import { roleHomePath } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * School Head login: provides School name, password = School ID code.
 * Maps to a synthetic email; Supabase password = schoolIdCode.
 */
export async function loginSchoolHead(formData: FormData): Promise<ActionResult> {
  const parsed = schoolLoginSchema.safeParse({
    schoolId: formData.get("schoolId"),
    role: "SCHOOL_HEAD",
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid input" };

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
}

/**
 * Teacher login: select School, then enter own email + password.
 * Teacher password is set during invite acceptance.
 */
export async function loginTeacher(formData: FormData): Promise<ActionResult> {
  const schoolId = String(formData.get("schoolId") ?? "");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!schoolId || !email || !password) return { ok: false, error: "All fields required" };

  // Verify the user exists and belongs to this school
  const user = await prisma.user.findFirst({
    where: { email, role: "TEACHER", schoolId, deletedAt: null, isActive: true },
    select: { id: true },
  });
  if (!user) return { ok: false, error: "Teacher not found in this school" };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: "Incorrect email or password" };

  redirect("/teacher");
}

export async function loginAdmin(formData: FormData): Promise<ActionResult> {
  const parsed = adminLoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error || !data.user) return { ok: false, error: "Incorrect credentials" };

  const user = await prisma.user.findUnique({ where: { authId: data.user.id } });
  if (!user || user.role !== "SUPER_ADMIN") {
    await supabase.auth.signOut();
    return { ok: false, error: "Not authorized" };
  }

  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

/**
 * Teacher invite acceptance: looks up TeacherInvite by tokenHash, creates a
 * Supabase auth user with the chosen password, creates the User row, marks
 * the invite consumed, and signs the user in.
 */
export async function acceptTeacherInvite(formData: FormData): Promise<ActionResult> {
  const parsed = teacherSetupSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const tokenHash = hashToken(parsed.data.token);
  const invite = await prisma.teacherInvite.findUnique({
    where: { tokenHash },
    include: { school: true },
  });
  if (!invite || invite.consumedAt || invite.expiresAt < new Date()) {
    return { ok: false, error: "This invite link is invalid or expired" };
  }

  const admin = createSupabaseAdminClient();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: invite.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { role: "TEACHER", schoolId: invite.schoolId },
  });
  if (createErr || !created.user) {
    return { ok: false, error: createErr?.message ?? "Failed to create account" };
  }

  const fullName = [invite.firstName, invite.middleName, invite.lastName].filter(Boolean).join(" ");
  await prisma.$transaction([
    prisma.user.create({
      data: {
        authId: created.user.id,
        email: invite.email,
        role: "TEACHER",
        schoolId: invite.schoolId,
        firstName: invite.firstName,
        middleName: invite.middleName,
        lastName: invite.lastName,
        fullName,
        isActive: true,
        profileCompleted: false,
      },
    }),
    prisma.teacherInvite.update({
      where: { id: invite.id },
      data: { consumedAt: new Date() },
    }),
  ]);

  // Sign the user in immediately
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signInWithPassword({
    email: invite.email,
    password: parsed.data.password,
  });

  redirect("/teacher");
}
