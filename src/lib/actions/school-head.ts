"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireSchoolUser } from "@/lib/auth/session";
import { schoolHeadProfileSchema } from "@/lib/validators/profile.schema";
import { createGradeLevelSchema } from "@/lib/validators/grade-level.schema";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import {
  revalidateSchoolDashboard,
  revalidateSchoolsList,
  revalidateTeacherDashboard,
} from "@/lib/cache/revalidate";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const teacherUserIdSchema = z.object({
  userId: z.string().uuid("Invalid teacher"),
});

const approveTeacherSchema = z.object({
  userId: z.string().uuid("Invalid teacher"),
  gradeLevelId: z.string().uuid("Grade level required"),
});

function formToObj(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (k.endsWith("[]")) {
      const key = k.slice(0, -2);
      const arr = (obj[key] as string[]) ?? [];
      arr.push(String(v));
      obj[key] = arr;
    } else if (obj[k] !== undefined) {
      obj[k] = Array.isArray(obj[k])
        ? [...(obj[k] as string[]), String(v)]
        : [obj[k] as string, String(v)];
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
  raw.hasReadingTraining =
    raw.hasReadingTraining === true ||
    raw.hasReadingTraining === "true" ||
    raw.hasReadingTraining === "on";
  raw.hasEnglishTraining =
    raw.hasEnglishTraining === true ||
    raw.hasEnglishTraining === "true" ||
    raw.hasEnglishTraining === "on";

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

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.SCHOOL_HEAD_PROFILE_SAVE,
    resource: "SchoolHeadProfile",
    resourceId: user.id,
    metadata: { schoolId: user.schoolId, userId: user.id },
  });

  revalidatePath("/school-head");
  revalidateSchoolDashboard(user.schoolId);
  // Login "teachers open" depends on a profiled School Head.
  revalidateSchoolsList();
}

export async function createGradeLevel(formData: FormData): Promise<void> {
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.schoolId || !user.profileCompleted) {
    throw new Error("Complete your profile first");
  }
  const parsed = createGradeLevelSchema.safeParse({ type: formData.get("type") });
  if (!parsed.success) throw new Error("Invalid grade level");

  const grade = await prisma.gradeLevel.upsert({
    where: { schoolId_type: { schoolId: user.schoolId, type: parsed.data.type } },
    update: { deletedAt: null },
    create: { schoolId: user.schoolId, type: parsed.data.type },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.GRADE_LEVEL_CREATE,
    resource: "GradeLevel",
    resourceId: grade.id,
    metadata: { schoolId: user.schoolId, gradeLevelId: grade.id, type: grade.type },
  });

  revalidatePath("/school-head/grade-levels");
  revalidateSchoolDashboard(user.schoolId);
  // Login "teachers open" depends on at least one grade level.
  revalidateSchoolsList();
}

/**
 * Approve a pending teacher self-registration and assign a grade level.
 */
export async function approveTeacher(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = approveTeacherSchema.safeParse({
    userId: formData.get("userId"),
    gradeLevelId: formData.get("gradeLevelId"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const [teacher, grade] = await Promise.all([
    prisma.user.findFirst({
      where: {
        id: parsed.data.userId,
        schoolId: user.schoolId,
        role: "TEACHER",
        approvalStatus: "PENDING",
        deletedAt: null,
      },
    }),
    prisma.gradeLevel.findFirst({
      where: {
        id: parsed.data.gradeLevelId,
        schoolId: user.schoolId,
        deletedAt: null,
      },
    }),
  ]);

  if (!teacher) return { ok: false, error: "Pending teacher not found" };
  if (!grade) return { ok: false, error: "Invalid grade level" };

  const adminClient = createSupabaseAdminClient();
  const { error: metaErr } = await adminClient.auth.admin.updateUserById(teacher.authId, {
    app_metadata: { role: "TEACHER", schoolId: user.schoolId },
  });
  if (metaErr) {
    console.error("[approveTeacher] app_metadata update failed:", metaErr);
    return { ok: false, error: metaErr.message || "Failed to update auth metadata" };
  }

  const now = new Date();
  await prisma.user.update({
    where: { id: teacher.id },
    data: {
      isActive: true,
      approvalStatus: "APPROVED",
      approvedAt: now,
      approvedById: user.id,
      taughtGrades: { connect: { id: grade.id } },
    },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.TEACHER_APPROVE,
    resource: "User",
    resourceId: teacher.id,
    metadata: {
      schoolId: user.schoolId,
      teacherId: teacher.id,
      gradeLevelId: grade.id,
    },
  });

  revalidatePath("/school-head/teachers");
  revalidateSchoolDashboard(user.schoolId);
  revalidateTeacherDashboard(teacher.id);
  return { ok: true };
}

/**
 * Reject a pending teacher self-registration.
 */
export async function rejectTeacher(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = teacherUserIdSchema.safeParse({ userId: formData.get("userId") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const teacher = await prisma.user.findFirst({
    where: {
      id: parsed.data.userId,
      schoolId: user.schoolId,
      role: "TEACHER",
      approvalStatus: "PENDING",
      deletedAt: null,
    },
  });
  if (!teacher) return { ok: false, error: "Pending teacher not found" };

  await prisma.user.update({
    where: { id: teacher.id },
    data: {
      approvalStatus: "REJECTED",
      isActive: false,
      rejectedAt: new Date(),
    },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.TEACHER_REJECT,
    resource: "User",
    resourceId: teacher.id,
    metadata: { schoolId: user.schoolId, teacherId: teacher.id },
  });

  revalidatePath("/school-head/teachers");
  revalidateSchoolDashboard(user.schoolId);
  revalidateTeacherDashboard(teacher.id);
  return { ok: true };
}

/**
 * Hard-delete a rejected (never-profiled) teacher so they can register again.
 * Deletes Supabase auth first to avoid an orphaned login that would block the email.
 */
export async function clearRejectedTeacher(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = teacherUserIdSchema.safeParse({ userId: formData.get("userId") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const teacher = await prisma.user.findFirst({
    where: {
      id: parsed.data.userId,
      schoolId: user.schoolId,
      role: "TEACHER",
      approvalStatus: "REJECTED",
      profileCompleted: false,
      deletedAt: null,
    },
  });
  if (!teacher) return { ok: false, error: "Rejected teacher not found" };

  const adminClient = createSupabaseAdminClient();
  const { error: authErr } = await adminClient.auth.admin.deleteUser(teacher.authId);
  if (authErr) {
    console.error("[clearRejectedTeacher] auth delete failed:", authErr);
    return { ok: false, error: authErr.message || "Failed to delete auth user" };
  }

  try {
    await prisma.user.delete({ where: { id: teacher.id } });
  } catch (err) {
    console.error("[clearRejectedTeacher] prisma delete failed after auth delete:", err);
    return {
      ok: false,
      error:
        "Auth account was removed but the teacher record could not be deleted. Contact support before asking them to re-register.",
    };
  }

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.TEACHER_REJECTION_CLEARED,
    resource: "User",
    resourceId: teacher.id,
    metadata: { schoolId: user.schoolId, teacherId: teacher.id },
  });

  revalidatePath("/school-head/teachers");
  revalidateSchoolDashboard(user.schoolId);
  return { ok: true };
}

export async function assignTeacherToGrade(formData: FormData): Promise<void> {
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.schoolId) throw new Error("No school");

  const teacherId = String(formData.get("teacherId") ?? "");
  const gradeLevelId = String(formData.get("gradeLevelId") ?? "");
  if (!teacherId || !gradeLevelId) throw new Error("Missing fields");

  const [teacher, grade] = await Promise.all([
    prisma.user.findFirst({ where: { id: teacherId, schoolId: user.schoolId, role: "TEACHER" } }),
    prisma.gradeLevel.findFirst({ where: { id: gradeLevelId, schoolId: user.schoolId } }),
  ]);
  if (!teacher || !grade) throw new Error("Invalid teacher or grade");

  await prisma.user.update({
    where: { id: teacherId },
    data: { taughtGrades: { connect: { id: gradeLevelId } } },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.TEACHER_ASSIGN_GRADE,
    resource: "User",
    resourceId: teacherId,
    metadata: { schoolId: user.schoolId, teacherId, gradeLevelId },
  });

  revalidatePath("/school-head/teachers");
  revalidateSchoolDashboard(user.schoolId);
  revalidateTeacherDashboard(teacherId);
}
