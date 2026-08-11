"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { GradeLevelType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, requireSchoolUser } from "@/lib/auth/session";
import { schoolHeadProfileSchema } from "@/lib/validators/profile.schema";
import {
  createGradeLevelSchema,
  schoolStructureSchema,
  type SchoolStructureInput,
} from "@/lib/validators/grade-level.schema";
import { lettersNeededToReachCount } from "@/lib/section-letters";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deleteAuthUser } from "@/lib/auth/delete-auth-user";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import {
  assignTeacherToSections,
  setTeacherSections,
} from "@/lib/teachers/section-assignment";

import {
  revalidateSchoolDashboard,
  revalidateSchoolsList,
  revalidateTeacherCaches,
} from "@/lib/cache/revalidate";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const teacherUserIdSchema = z.object({
  userId: z.string().uuid("Invalid teacher"),
});

const sectionIdsSchema = z
  .array(z.string().uuid("Invalid section"))
  .min(1, "Select at least one section");

const approveTeacherSchema = z.object({
  userId: z.string().uuid("Invalid teacher"),
  sectionIds: sectionIdsSchema,
});

const setTeacherSectionAssignmentsSchema = z.object({
  userId: z.string().uuid("Invalid teacher"),
  sectionIds: sectionIdsSchema,
});

const assignTeachersToSectionsSchema = z.object({
  userIds: z
    .array(z.string().uuid("Invalid teacher"))
    .min(1, "Select at least one teacher"),
  sectionIds: sectionIdsSchema,
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

function parseSectionIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  if (typeof raw === "string" && raw.length > 0) return [raw];
  return [];
}

/**
 * Upsert selected grade levels and ensure each has at least `sectionsPerGrade`
 * letter-named sections (A, B, C…). Never deletes existing grades/sections.
 *
 * Runs as short pooled queries (no interactive $transaction) so PgBouncer
 * transaction mode does not drop a long-lived txn mid-bootstrap.
 */
async function bootstrapSchoolStructure(params: {
  schoolId: string;
  gradeTypes: GradeLevelType[];
  sectionsPerGrade: number;
}): Promise<{ createdGradeIds: string[]; createdSectionIds: string[] }> {
  const { schoolId, gradeTypes, sectionsPerGrade } = params;
  const createdGradeIds: string[] = [];
  const createdSectionIds: string[] = [];

  if (gradeTypes.length === 0) {
    return { createdGradeIds, createdSectionIds };
  }

  const existingGrades = await prisma.gradeLevel.findMany({
    where: { schoolId, type: { in: gradeTypes } },
    select: { id: true, type: true, deletedAt: true },
  });
  const gradeByType = new Map(existingGrades.map((g) => [g.type, g]));

  const typesToCreate = gradeTypes.filter((t) => !gradeByType.has(t));
  const gradesToRestore = existingGrades.filter((g) => g.deletedAt);

  if (typesToCreate.length > 0) {
    await prisma.gradeLevel.createMany({
      data: typesToCreate.map((type) => ({ schoolId, type })),
      skipDuplicates: true,
    });
  }
  if (gradesToRestore.length > 0) {
    const restoreIds = gradesToRestore.map((g) => g.id);
    await prisma.gradeLevel.updateMany({
      where: { id: { in: restoreIds } },
      data: { deletedAt: null },
    });
    createdGradeIds.push(...restoreIds);
  }

  const grades = await prisma.gradeLevel.findMany({
    where: { schoolId, type: { in: gradeTypes }, deletedAt: null },
    select: { id: true, type: true },
  });
  for (const g of grades) {
    if (!gradeByType.has(g.type)) {
      createdGradeIds.push(g.id);
    }
  }

  const gradeIds = grades.map((g) => g.id);
  if (gradeIds.length === 0) {
    return { createdGradeIds, createdSectionIds };
  }

  const sections = await prisma.section.findMany({
    where: { schoolId, gradeLevelId: { in: gradeIds } },
    select: { id: true, name: true, deletedAt: true, gradeLevelId: true },
  });
  const sectionsByGrade = new Map<string, typeof sections>();
  for (const s of sections) {
    const list = sectionsByGrade.get(s.gradeLevelId) ?? [];
    list.push(s);
    sectionsByGrade.set(s.gradeLevelId, list);
  }

  const toRestoreIds: string[] = [];
  const toCreate: { schoolId: string; gradeLevelId: string; name: string }[] = [];

  for (const grade of grades) {
    const gradeSections = sectionsByGrade.get(grade.id) ?? [];
    const activeNames = gradeSections.filter((s) => !s.deletedAt).map((s) => s.name);
    const letters = lettersNeededToReachCount(activeNames, sectionsPerGrade);

    for (const name of letters) {
      const softDeleted = gradeSections.find(
        (s) => s.deletedAt && s.name.trim().toUpperCase() === name
      );
      if (softDeleted) {
        toRestoreIds.push(softDeleted.id);
      } else {
        toCreate.push({ schoolId, gradeLevelId: grade.id, name });
      }
    }
  }

  if (toRestoreIds.length > 0) {
    await prisma.section.updateMany({
      where: { id: { in: toRestoreIds } },
      data: { deletedAt: null },
    });
    createdSectionIds.push(...toRestoreIds);
  }

  if (toCreate.length > 0) {
    await prisma.section.createMany({
      data: toCreate,
      skipDuplicates: true,
    });

    const createKey = new Set(
      toCreate.map((c) => `${c.gradeLevelId}:${c.name}`)
    );
    const created = await prisma.section.findMany({
      where: {
        schoolId,
        gradeLevelId: { in: [...new Set(toCreate.map((c) => c.gradeLevelId))] },
        name: { in: [...new Set(toCreate.map((c) => c.name))] },
        deletedAt: null,
      },
      select: { id: true, gradeLevelId: true, name: true },
    });
    for (const s of created) {
      if (createKey.has(`${s.gradeLevelId}:${s.name}`)) {
        createdSectionIds.push(s.id);
      }
    }
  }

  return { createdGradeIds, createdSectionIds };
}

export async function saveSchoolHeadProfile(formData: FormData): Promise<ActionResult> {
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.schoolId) return { ok: false, error: "User has no school" };

  const raw = formToObj(formData);
  raw.hasReadingTraining =
    raw.hasReadingTraining === true ||
    raw.hasReadingTraining === "true" ||
    raw.hasReadingTraining === "on";
  raw.hasEnglishTraining =
    raw.hasEnglishTraining === true ||
    raw.hasEnglishTraining === "true" ||
    raw.hasEnglishTraining === "on";

  // Arrays may arrive as a single string when only one checkbox is selected.
  if (typeof raw.gradeTypes === "string" && raw.gradeTypes) {
    raw.gradeTypes = [raw.gradeTypes];
  }

  const skipSchoolStructure =
    raw.skipSchoolStructure === true ||
    raw.skipSchoolStructure === "true" ||
    raw.skipSchoolStructure === "on";

  const parsed = schoolHeadProfileSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  let gradeTypes: SchoolStructureInput["gradeTypes"] | undefined;
  let sectionsPerGrade: SchoolStructureInput["sectionsPerGrade"] | undefined;
  if (!skipSchoolStructure) {
    const structureParsed = schoolStructureSchema.safeParse({
      gradeTypes: raw.gradeTypes,
      sectionsPerGrade: raw.sectionsPerGrade,
    });
    if (!structureParsed.success) {
      return {
        ok: false,
        error: structureParsed.error.errors[0]?.message ?? "Invalid school structure",
      };
    }
    gradeTypes = structureParsed.data.gradeTypes;
    sectionsPerGrade = structureParsed.data.sectionsPerGrade;
  }

  const {
    firstName,
    lastName,
    middleName: middleRaw,
    contactEmail: _contactEmail,
    ...profileData
  } = parsed.data;
  const middleName = middleRaw?.trim() ? middleRaw.trim() : null;
  const fullName = [firstName, middleName, lastName].filter(Boolean).join(" ");
  const schoolId = user.schoolId;

  // Leave contactEmail untouched — no longer collected in the profiling UI.
  // Save profile first (short pooled queries), then bootstrap grades/sections
  // outside any interactive transaction. PgBouncer transaction-mode pooler
  // drops long interactive txns mid-flight ("Transaction not found").
  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { firstName, middleName, lastName, fullName, profileCompleted: true },
    });
    await prisma.schoolHeadProfile.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...profileData },
      update: { ...profileData },
    });
  } catch (err) {
    console.error("[saveSchoolHeadProfile] profile save failed:", err);
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Failed to save profile",
    };
  }

  let bootstrap: { createdGradeIds: string[]; createdSectionIds: string[] } = {
    createdGradeIds: [],
    createdSectionIds: [],
  };
  if (!skipSchoolStructure && gradeTypes && sectionsPerGrade != null) {
    try {
      bootstrap = await bootstrapSchoolStructure({
        schoolId,
        gradeTypes,
        sectionsPerGrade,
      });
    } catch (err) {
      console.error("[saveSchoolHeadProfile] bootstrap failed:", err);
      return {
        ok: false,
        error:
          err instanceof Error
            ? `Profile saved, but school structure setup failed: ${err.message}. You can retry.`
            : "Profile saved, but school structure setup failed. You can retry.",
      };
    }
  }

  await writeAudit({
    userId: user.id,
    schoolId,
    action: AUDIT_ACTIONS.SCHOOL_HEAD_PROFILE_SAVE,
    resource: "SchoolHeadProfile",
    resourceId: user.id,
    metadata: {
      schoolId,
      userId: user.id,
      skipSchoolStructure,
      ...(gradeTypes ? { gradeTypes } : {}),
      ...(sectionsPerGrade != null ? { sectionsPerGrade } : {}),
      createdGradeCount: bootstrap.createdGradeIds.length,
      createdSectionCount: bootstrap.createdSectionIds.length,
    },
  });

  for (const gradeId of bootstrap.createdGradeIds) {
    await writeAudit({
      userId: user.id,
      schoolId,
      action: AUDIT_ACTIONS.GRADE_LEVEL_CREATE,
      resource: "GradeLevel",
      resourceId: gradeId,
      metadata: { schoolId, gradeLevelId: gradeId, source: "profiling_bootstrap" },
    });
  }
  for (const sectionId of bootstrap.createdSectionIds) {
    await writeAudit({
      userId: user.id,
      schoolId,
      action: AUDIT_ACTIONS.SECTION_CREATE,
      resource: "Section",
      resourceId: sectionId,
      metadata: { schoolId, sectionId, source: "profiling_bootstrap" },
    });
  }

  revalidatePath("/school-head/settings/profile");
  revalidatePath("/school-head/grade-levels");
  revalidatePath("/school-head/sections");
  revalidateSchoolDashboard(schoolId);
  // Login "teachers open" depends on a profiled School Head + grade levels.
  revalidateSchoolsList();
  return { ok: true };
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
 * Approve a pending teacher self-registration and assign one or more sections.
 */
export async function approveTeacher(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const raw = formToObj(formData);
  const parsed = approveTeacherSchema.safeParse({
    userId: raw.userId,
    sectionIds: parseSectionIds(raw.sectionIds),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const { userId, sectionIds } = parsed.data;

  const [teacher, sections] = await Promise.all([
    prisma.user.findFirst({
      where: {
        id: userId,
        schoolId: user.schoolId,
        role: "TEACHER",
        approvalStatus: "PENDING",
        deletedAt: null,
      },
    }),
    prisma.section.findMany({
      where: {
        id: { in: sectionIds },
        schoolId: user.schoolId,
        deletedAt: null,
      },
      select: { id: true },
    }),
  ]);

  if (!teacher) return { ok: false, error: "Pending teacher not found" };
  if (sections.length !== new Set(sectionIds).size) {
    return { ok: false, error: "One or more sections are invalid" };
  }

  const adminClient = createSupabaseAdminClient();
  const { error: metaErr } = await adminClient.auth.admin.updateUserById(teacher.authId, {
    app_metadata: { role: "TEACHER", schoolId: user.schoolId },
  });
  if (metaErr) {
    console.error("[approveTeacher] app_metadata update failed:", metaErr);
    return { ok: false, error: metaErr.message || "Failed to update auth metadata" };
  }

  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: teacher.id },
        data: {
          isActive: true,
          approvalStatus: "APPROVED",
          approvedAt: now,
          approvedById: user.id,
        },
      });
      await assignTeacherToSections(tx, {
        teacherId: teacher.id,
        sectionIds,
        schoolId: user.schoolId,
      });
    });
  } catch (err) {
    console.error("[approveTeacher] assign sections failed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to assign sections",
    };
  }

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.TEACHER_APPROVE,
    resource: "User",
    resourceId: teacher.id,
    metadata: {
      schoolId: user.schoolId,
      teacherId: teacher.id,
      sectionIds,
    },
  });

  revalidatePath("/school-head/teachers");
  revalidateSchoolDashboard(user.schoolId);
  revalidateTeacherCaches(teacher.id);
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
  revalidateTeacherCaches(teacher.id);
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

  const authDelete = await deleteAuthUser(teacher.authId);
  if (!authDelete.ok) {
    console.error("[clearRejectedTeacher] auth delete failed:", authDelete.error);
    return { ok: false, error: authDelete.error };
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

const setTeacherActiveSchema = z.object({
  userId: z.string().uuid("Invalid teacher"),
  isActive: z
    .union([z.boolean(), z.literal("true"), z.literal("false")])
    .transform((v) => v === true || v === "true"),
});

/**
 * Deactivate or reactivate an approved teacher at this school.
 * Deactivated teachers cannot sign in; historical learner links are kept.
 */
export async function setTeacherActive(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = setTeacherActiveSchema.safeParse({
    userId: formData.get("userId"),
    isActive: formData.get("isActive"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const teacher = await prisma.user.findFirst({
    where: {
      id: parsed.data.userId,
      schoolId: user.schoolId,
      role: "TEACHER",
      approvalStatus: "APPROVED",
      deletedAt: null,
    },
  });
  if (!teacher) return { ok: false, error: "Teacher not found" };

  if (teacher.isActive === parsed.data.isActive) {
    return { ok: true };
  }

  await prisma.user.update({
    where: { id: teacher.id },
    data: { isActive: parsed.data.isActive },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: parsed.data.isActive
      ? AUDIT_ACTIONS.TEACHER_REACTIVATE
      : AUDIT_ACTIONS.TEACHER_DEACTIVATE,
    resource: "User",
    resourceId: teacher.id,
    metadata: {
      schoolId: user.schoolId,
      teacherId: teacher.id,
      isActive: parsed.data.isActive,
    },
  });

  revalidatePath("/school-head/teachers");
  revalidateSchoolDashboard(user.schoolId);
  revalidateTeacherCaches(teacher.id);
  return { ok: true };
}

/**
 * Soft-remove an approved teacher: blocks sign-in, frees the email for re-register,
 * and keeps historical records (learners / attendance) intact.
 * Refuses when the teacher still has active (non-deleted) learners — reassign first.
 */
export async function removeTeacher(formData: FormData): Promise<ActionResult> {
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
      approvalStatus: "APPROVED",
      deletedAt: null,
    },
    include: {
      taughtGrades: { select: { id: true } },
      _count: {
        select: {
          managedLearners: { where: { deletedAt: null } },
        },
      },
    },
  });
  if (!teacher) return { ok: false, error: "Teacher not found" };

  if (teacher._count.managedLearners > 0) {
    return {
      ok: false,
      error: `Reassign or transfer ${teacher._count.managedLearners} learner(s) before removing this teacher.`,
    };
  }

  const authDelete = await deleteAuthUser(teacher.authId);
  if (!authDelete.ok) {
    console.error("[removeTeacher] auth delete failed:", authDelete.error);
    return { ok: false, error: authDelete.error };
  }

  const freedEmail = `${teacher.email}.deleted.${Date.now()}`;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.teacherSection.deleteMany({ where: { teacherId: teacher.id } });
      await tx.user.update({
        where: { id: teacher.id },
        data: {
          email: freedEmail,
          isActive: false,
          deletedAt: new Date(),
          taughtGrades:
            teacher.taughtGrades.length > 0
              ? { disconnect: teacher.taughtGrades.map((g) => ({ id: g.id })) }
              : undefined,
        },
      });
    });
  } catch (err) {
    console.error("[removeTeacher] prisma soft-delete failed after auth delete:", err);
    return {
      ok: false,
      error:
        "Auth account was removed but the teacher record could not be updated. Contact support before asking them to re-register.",
    };
  }

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.TEACHER_REMOVE,
    resource: "User",
    resourceId: teacher.id,
    metadata: { schoolId: user.schoolId, teacherId: teacher.id },
  });

  revalidatePath("/school-head/teachers");
  revalidateSchoolDashboard(user.schoolId);
  revalidateTeacherCaches(teacher.id);
  return { ok: true };
}

/**
 * Replace a teacher's section assignments (dual-writes taughtGrades).
 */
export async function setTeacherSectionAssignments(
  formData: FormData
): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const raw = formToObj(formData);
  const parsed = setTeacherSectionAssignmentsSchema.safeParse({
    userId: raw.userId,
    sectionIds: parseSectionIds(raw.sectionIds),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const { userId, sectionIds } = parsed.data;

  const teacher = await prisma.user.findFirst({
    where: {
      id: userId,
      schoolId: user.schoolId,
      role: "TEACHER",
      approvalStatus: "APPROVED",
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!teacher) return { ok: false, error: "Teacher not found" };

  try {
    await prisma.$transaction(async (tx) => {
      await setTeacherSections(tx, {
        teacherId: teacher.id,
        sectionIds,
        schoolId: user.schoolId,
      });
    });
  } catch (err) {
    console.error("[setTeacherSectionAssignments] failed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update section assignments",
    };
  }

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.TEACHER_ASSIGN_SECTIONS,
    resource: "User",
    resourceId: teacher.id,
    metadata: {
      schoolId: user.schoolId,
      teacherId: teacher.id,
      sectionIds,
    },
  });

  revalidatePath("/school-head/teachers");
  revalidateSchoolDashboard(user.schoolId);
  revalidateTeacherCaches(teacher.id);
  return { ok: true };
}

/**
 * Additive section assign (dual-writes taughtGrades). Prefer
 * {@link setTeacherSectionAssignments} when replacing the full set.
 */
export async function assignTeacherSections(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const raw = formToObj(formData);
  const parsed = setTeacherSectionAssignmentsSchema.safeParse({
    userId: raw.userId,
    sectionIds: parseSectionIds(raw.sectionIds),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const { userId, sectionIds } = parsed.data;

  const teacher = await prisma.user.findFirst({
    where: {
      id: userId,
      schoolId: user.schoolId,
      role: "TEACHER",
      approvalStatus: "APPROVED",
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!teacher) return { ok: false, error: "Teacher not found" };

  try {
    await prisma.$transaction(async (tx) => {
      await assignTeacherToSections(tx, {
        teacherId: teacher.id,
        sectionIds,
        schoolId: user.schoolId,
      });
    });
  } catch (err) {
    console.error("[assignTeacherSections] failed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to assign sections",
    };
  }

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.TEACHER_ASSIGN_SECTIONS,
    resource: "User",
    resourceId: teacher.id,
    metadata: {
      schoolId: user.schoolId,
      teacherId: teacher.id,
      sectionIds,
      mode: "additive",
    },
  });

  revalidatePath("/school-head/teachers");
  revalidateSchoolDashboard(user.schoolId);
  revalidateTeacherCaches(teacher.id);
  return { ok: true };
}

/**
 * Bulk additive assign: add the same section set to each selected teacher
 * without removing their existing section assignments.
 */
export async function assignTeachersToSections(
  formData: FormData
): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const raw = formToObj(formData);
  const parsed = assignTeachersToSectionsSchema.safeParse({
    userIds: parseSectionIds(raw.userIds),
    sectionIds: parseSectionIds(raw.sectionIds),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const userIds = [...new Set(parsed.data.userIds)];
  const sectionIds = [...new Set(parsed.data.sectionIds)];

  const teachers = await prisma.user.findMany({
    where: {
      id: { in: userIds },
      schoolId: user.schoolId,
      role: "TEACHER",
      approvalStatus: "APPROVED",
      deletedAt: null,
    },
    select: { id: true },
  });
  if (teachers.length !== userIds.length) {
    return { ok: false, error: "One or more teachers are invalid or not approved" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const teacher of teachers) {
        await assignTeacherToSections(tx, {
          teacherId: teacher.id,
          sectionIds,
          schoolId: user.schoolId,
        });
      }
    });
  } catch (err) {
    console.error("[assignTeachersToSections] failed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to assign sections",
    };
  }

  const teacherIds = teachers.map((t) => t.id);

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.TEACHER_ASSIGN_SECTIONS,
    resource: "User",
    resourceId: user.schoolId,
    metadata: {
      schoolId: user.schoolId,
      teacherIds,
      sectionIds,
      mode: "additive",
      bulk: true,
    },
  });

  revalidatePath("/school-head/teachers");
  revalidateSchoolDashboard(user.schoolId);
  for (const teacherId of teacherIds) {
    revalidateTeacherCaches(teacherId);
  }
  return { ok: true };
}

/**
 * @deprecated Use {@link setTeacherSectionAssignments} (section-based dual-write).
 */
export async function assignTeacherToGrade(_formData: FormData): Promise<void> {
  throw new Error(
    "assignTeacherToGrade is deprecated; use setTeacherSectionAssignments instead"
  );
}
