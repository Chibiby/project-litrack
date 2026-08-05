"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/roles";
import { schoolHeadProfileSchema } from "@/lib/validators/profile.schema";
import { createGradeLevelSchema, teacherInviteSchema } from "@/lib/validators/teacher-invite.schema";
import { generateInviteToken } from "@/lib/auth/invites";
import { sendTeacherInviteEmail } from "@/lib/email/resend";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { teacherSyntheticEmail } from "@/lib/auth/synthetic-email";
import { getAppBaseUrl } from "@/lib/url";
import { randomBytes } from "crypto";
import type { User } from "@prisma/client";

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

/**
 * Resolve the school context for school-head mutations.
 * SUPER_ADMIN may pass schoolId (must exist). SCHOOL_HEAD always uses their own
 * schoolId and cannot target another school even if schoolId is forged in the form.
 */
async function resolveActingSchoolId(user: User, formData: FormData): Promise<string> {
  const requested = String(formData.get("schoolId") ?? "").trim();

  if (isSuperAdmin(user)) {
    if (!requested) throw new Error("schoolId is required when acting as Super Admin");
    const school = await prisma.school.findFirst({
      where: { id: requested, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (!school) throw new Error("School not found or inactive");
    return school.id;
  }

  if (!user.schoolId) throw new Error("User has no school");
  if (requested && requested !== user.schoolId) {
    throw new Error("Forbidden");
  }
  return user.schoolId;
}

function assertProfileReady(user: User): void {
  if (isSuperAdmin(user)) return;
  if (!user.profileCompleted) throw new Error("Complete your profile first");
}

export async function saveSchoolHeadProfile(formData: FormData): Promise<void> {
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.schoolId) throw new Error("User has no school");

  const raw = formToObj(formData);
  raw.hasReadingTraining = raw.hasReadingTraining === true || raw.hasReadingTraining === "true" || raw.hasReadingTraining === "on";
  raw.hasEnglishTraining = raw.hasEnglishTraining === true || raw.hasEnglishTraining === "true" || raw.hasEnglishTraining === "on";

  const parsed = schoolHeadProfileSchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.errors[0]?.message ?? "Invalid input");

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
  assertProfileReady(user);
  const schoolId = await resolveActingSchoolId(user, formData);

  const parsed = createGradeLevelSchema.safeParse({ type: formData.get("type") });
  if (!parsed.success) throw new Error("Invalid grade level");

  await prisma.gradeLevel.upsert({
    where: { schoolId_type: { schoolId, type: parsed.data.type } },
    update: { deletedAt: null },
    create: { schoolId, type: parsed.data.type },
  });

  revalidatePath("/school-head/grade-levels");
}

export async function inviteTeacher(formData: FormData): Promise<ActionResult> {
  const user = await requireUser("SCHOOL_HEAD");
  assertProfileReady(user);
  const schoolId = await resolveActingSchoolId(user, formData);

  const parsed = teacherInviteSchema.safeParse({
    gradeLevelId: formData.get("gradeLevelId"),
    email: formData.get("email"),
    firstName: formData.get("firstName"),
    middleName: formData.get("middleName"),
    lastName: formData.get("lastName"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };

  const grade = await prisma.gradeLevel.findFirst({
    where: { id: parsed.data.gradeLevelId, schoolId, deletedAt: null },
  });
  if (!grade) return { ok: false, error: "Invalid grade level" };

  const exists = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (exists) return { ok: false, error: "Email is already in use" };

  const base = getAppBaseUrl();
  if (!base.ok) {
    console.error("[inviteTeacher]", base.error);
    return { ok: false, error: base.error };
  }

  const { token, tokenHash, expiresAt } = generateInviteToken();
  await prisma.teacherInvite.create({
    data: {
      schoolId,
      gradeLevelId: parsed.data.gradeLevelId,
      email: parsed.data.email,
      firstName: parsed.data.firstName,
      middleName: parsed.data.middleName,
      lastName: parsed.data.lastName,
      tokenHash,
      expiresAt,
    },
  });

  const inviteUrl = `${base.url}/teacher-setup/${token}`;
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { name: true },
  });

  try {
    await sendTeacherInviteEmail({
      to: parsed.data.email,
      teacherName: [parsed.data.firstName, parsed.data.lastName].join(" "),
      schoolName: school?.name ?? "your school",
      inviteUrl,
    });
  } catch (e) {
    console.error("[invite email] failed:", e);
  }

  revalidatePath("/school-head/teachers");
  return { ok: true };
}

export async function assignTeacherToGrade(formData: FormData): Promise<void> {
  const user = await requireUser("SCHOOL_HEAD");
  const schoolId = await resolveActingSchoolId(user, formData);

  const teacherId = String(formData.get("teacherId") ?? "");
  const gradeLevelId = String(formData.get("gradeLevelId") ?? "");
  if (!teacherId || !gradeLevelId) throw new Error("Missing fields");

  const [teacher, grade] = await Promise.all([
    prisma.user.findFirst({ where: { id: teacherId, schoolId, role: "TEACHER" } }),
    prisma.gradeLevel.findFirst({ where: { id: gradeLevelId, schoolId } }),
  ]);
  if (!teacher || !grade) throw new Error("Invalid teacher or grade");

  await prisma.user.update({
    where: { id: teacherId },
    data: { taughtGrades: { connect: { id: gradeLevelId } } },
  });

  revalidatePath("/school-head/teachers");
}

/** 16 bytes CSPRNG → 32 hex chars (human-shareable). */
function generateTempPassword(): string {
  return randomBytes(16).toString("hex");
}

export async function createTeacherDirect(
  formData: FormData
): Promise<{ ok: true; username: string; tempPassword: string } | { ok: false; error: string }> {
  const user = await requireUser("SCHOOL_HEAD");
  try {
    assertProfileReady(user);
    const schoolId = await resolveActingSchoolId(user, formData);

    const firstName = String(formData.get("firstName") ?? "").trim();
    const middleName = String(formData.get("middleName") ?? "").trim() || null;
    const lastName = String(formData.get("lastName") ?? "").trim();
    const gradeLevelId = String(formData.get("gradeLevelId") ?? "");

    if (!firstName || !lastName || !gradeLevelId) {
      return { ok: false, error: "First name, last name, and grade level are required" };
    }

    const grade = await prisma.gradeLevel.findFirst({
      where: { id: gradeLevelId, schoolId, deletedAt: null },
    });
    if (!grade) return { ok: false, error: "Invalid grade level" };

    const baseUsername = `teacher.${lastName.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    const randomSuffix = randomBytes(2).toString("hex");
    const username = `${baseUsername}.${randomSuffix}`;
    const tempPassword = generateTempPassword();
    const syntheticEmail = teacherSyntheticEmail(username);

    const admin = createSupabaseAdminClient();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: syntheticEmail,
      password: tempPassword,
      email_confirm: true,
      app_metadata: { role: "TEACHER", schoolId },
      user_metadata: { username },
    });
    if (createErr || !created.user) {
      console.error("[createTeacherDirect] auth createUser failed:", createErr);
      return { ok: false, error: "Failed to create teacher account. Please try again." };
    }

    const authUserId = created.user.id;
    const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ");

    try {
      await prisma.user.create({
        data: {
          authId: authUserId,
          email: syntheticEmail,
          role: "TEACHER",
          schoolId,
          firstName,
          middleName,
          lastName,
          fullName,
          isActive: true,
          profileCompleted: false,
          taughtGrades: { connect: { id: gradeLevelId } },
        },
      });
    } catch (err) {
      console.error("[createTeacherDirect] prisma failed; deleting auth user:", err);
      try {
        await admin.auth.admin.deleteUser(authUserId);
      } catch (cleanupErr) {
        console.error("[createTeacherDirect] auth cleanup failed:", cleanupErr);
      }
      return { ok: false, error: "Failed to create teacher account. Please try again." };
    }

    revalidatePath("/school-head/teachers");
    return { ok: true, username, tempPassword };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create teacher";
    if (message === "Forbidden" || message.includes("schoolId") || message.includes("profile")) {
      console.error("[createTeacherDirect] auth/ownership:", err);
      return { ok: false, error: "You are not allowed to do that." };
    }
    console.error("[createTeacherDirect]", err);
    return { ok: false, error: "Could not create the teacher account." };
  }
}
