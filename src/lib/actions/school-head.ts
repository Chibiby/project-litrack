"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { schoolHeadProfileSchema } from "@/lib/validators/profile.schema";
import { createGradeLevelSchema, teacherInviteSchema } from "@/lib/validators/teacher-invite.schema";
import { generateInviteToken } from "@/lib/auth/invites";
import { sendTeacherInviteEmail } from "@/lib/email/resend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { randomBytes } from "crypto";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

function formToObj(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k.endsWith("[]")) {
      const key = k.slice(0, -2);
      const arr = (obj[key] as string[]) ?? [];
      arr.push(String(v));
      obj[key] = arr;
    } else if (obj[k] !== undefined) {
      obj[k] = Array.isArray(obj[k]) ? [...(obj[k] as string[]), String(v)] : [obj[k] as string, String(v)];
    } else {
      obj[k] = v === "on" ? true : v === "off" ? false : v;
    }
  }
  return obj;
}

export async function saveSchoolHeadProfile(formData: FormData): Promise<void> {
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.schoolId) throw new Error("User has no school");

  const raw = formToObj(formData);
  // Booleans in checkboxes
  raw.hasReadingTraining = raw.hasReadingTraining === true || raw.hasReadingTraining === "true" || raw.hasReadingTraining === "on";
  raw.hasEnglishTraining = raw.hasEnglishTraining === true || raw.hasEnglishTraining === "true" || raw.hasEnglishTraining === "on";

  const parsed = schoolHeadProfileSchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.errors[0]?.message ?? "Invalid input");

  // Optional: full name from form (since SH was bootstrapped with placeholder)
  const firstName = String(formData.get("firstName") ?? user.firstName).trim();
  const middleName = String(formData.get("middleName") ?? "").trim() || null;
  const lastName = String(formData.get("lastName") ?? user.lastName).trim();
  const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ");

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { firstName, middleName, lastName, fullName, profileCompleted: true },
    }),
    prisma.schoolHeadProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...parsed.data },
      update: { ...parsed.data },
    }),
  ]);

  revalidatePath("/school-head");
}

export async function createGradeLevel(formData: FormData): Promise<void> {
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.schoolId || !user.profileCompleted) {
    throw new Error("Complete your profile first");
  }
  const parsed = createGradeLevelSchema.safeParse({ type: formData.get("type") });
  if (!parsed.success) throw new Error("Invalid grade level");

  await prisma.gradeLevel.upsert({
    where: { schoolId_type: { schoolId: user.schoolId, type: parsed.data.type } },
    update: { deletedAt: null },
    create: { schoolId: user.schoolId, type: parsed.data.type },
  });

  revalidatePath("/school-head/grade-levels");
}

export async function inviteTeacher(formData: FormData): Promise<void> {
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.schoolId || !user.profileCompleted) {
    throw new Error("Complete your profile first");
  }

  const parsed = teacherInviteSchema.safeParse({
    gradeLevelId: formData.get("gradeLevelId"),
    email: formData.get("email"),
    firstName: formData.get("firstName"),
    middleName: formData.get("middleName"),
    lastName: formData.get("lastName"),
  });
  if (!parsed.success) throw new Error(parsed.error.errors[0]?.message ?? "Invalid input");

  // Validate grade belongs to school
  const grade = await prisma.gradeLevel.findFirst({
    where: { id: parsed.data.gradeLevelId, schoolId: user.schoolId, deletedAt: null },
  });
  if (!grade) throw new Error("Invalid grade level");

  // Check email uniqueness
  const exists = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (exists) throw new Error("Email is already in use");

  const { token, tokenHash, expiresAt } = generateInviteToken();
  await prisma.teacherInvite.create({
    data: {
      schoolId: user.schoolId,
      email: parsed.data.email,
      firstName: parsed.data.firstName,
      middleName: parsed.data.middleName,
      lastName: parsed.data.lastName,
      tokenHash,
      expiresAt,
    },
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const inviteUrl = `${baseUrl}/teacher-setup/${token}`;
  const school = await prisma.school.findUnique({
    where: { id: user.schoolId },
    select: { name: true },
  });

  // Send email; on local dev without RESEND_API_KEY this no-ops.
  try {
    await sendTeacherInviteEmail({
      to: parsed.data.email,
      teacherName: [parsed.data.firstName, parsed.data.lastName].join(" "),
      schoolName: school?.name ?? "your school",
      inviteUrl,
    });
  } catch (e) {
    // Log but don't block — SH can resend later
    console.error("[invite email] failed:", e);
  }

  // After invite, the teacher is associated to the chosen grade once they accept.
  // We model that by adding the grade to the user's taughtGrades on acceptance.
  // For now, we stash gradeLevelId in metadata via a temporary mapping table
  // approach is overkill — we just store it on TeacherInvite via an extra column
  // (out of scope for MVP; SH can assign grade after teacher accepts).

  revalidatePath("/school-head/teachers");
}

export async function assignTeacherToGrade(formData: FormData): Promise<void> {
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.schoolId) throw new Error("No school");

  const teacherId = String(formData.get("teacherId") ?? "");
  const gradeLevelId = String(formData.get("gradeLevelId") ?? "");
  if (!teacherId || !gradeLevelId) throw new Error("Missing fields");

  // Verify both belong to the SH's school
  const [teacher, grade] = await Promise.all([
    prisma.user.findFirst({ where: { id: teacherId, schoolId: user.schoolId, role: "TEACHER" } }),
    prisma.gradeLevel.findFirst({ where: { id: gradeLevelId, schoolId: user.schoolId } }),
  ]);
  if (!teacher || !grade) throw new Error("Invalid teacher or grade");

  await prisma.user.update({
    where: { id: teacherId },
    data: { taughtGrades: { connect: { id: gradeLevelId } } },
  });

  revalidatePath("/school-head/teachers");
}

function generateTempPassword(): string {
  return randomBytes(4).toString("hex").toUpperCase(); // 8 chars, e.g., "A1B2C3D4"
}

export async function createTeacherDirect(formData: FormData): Promise<{ username: string; tempPassword: string }> {
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.schoolId || !user.profileCompleted) {
    throw new Error("Complete your profile first");
  }

  const firstName = String(formData.get("firstName") ?? "").trim();
  const middleName = String(formData.get("middleName") ?? "").trim() || null;
  const lastName = String(formData.get("lastName") ?? "").trim();
  const gradeLevelId = String(formData.get("gradeLevelId") ?? "");

  if (!firstName || !lastName || !gradeLevelId) {
    throw new Error("First name, last name, and grade level are required");
  }

  // Verify grade belongs to school
  const grade = await prisma.gradeLevel.findFirst({
    where: { id: gradeLevelId, schoolId: user.schoolId, deletedAt: null },
  });
  if (!grade) throw new Error("Invalid grade level");

  // Generate unique username based on last name + random suffix
  const baseUsername = `teacher.${lastName.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  const randomSuffix = randomBytes(2).toString("hex"); // 4 chars
  const username = `${baseUsername}.${randomSuffix}`;

  // Generate temporary password
  const tempPassword = generateTempPassword();

  // Generate synthetic email for Supabase (not used for login, but required)
  const syntheticEmail = `${username}@school.local`;

  // Create Supabase auth user
  const admin = createSupabaseAdminClient();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: syntheticEmail,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { role: "TEACHER", schoolId: user.schoolId, username },
  });
  if (createErr || !created.user) {
    throw new Error(createErr?.message ?? "Failed to create teacher account");
  }

  // Create User record in database
  const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ");
  await prisma.user.create({
    data: {
      authId: created.user.id,
      email: syntheticEmail, // Store synthetic email
      role: "TEACHER",
      schoolId: user.schoolId,
      firstName,
      middleName,
      lastName,
      fullName,
      isActive: true,
      profileCompleted: false,
      taughtGrades: { connect: { id: gradeLevelId } },
    },
  });

  revalidatePath("/school-head/teachers");
  return { username, tempPassword };
}
