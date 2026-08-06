"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser, requireUser } from "@/lib/auth/session";
import { assertSameSchool } from "@/lib/auth/tenant";
import {
  transferLearnerSchema,
  transferLearnerCrossSchoolSchema,
} from "@/lib/validators/enrollment.schema";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Same-school transfer: grade and/or section and/or teacher.
 */
export async function transferLearner(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = transferLearnerSchema.safeParse({
    learnerId: formData.get("learnerId"),
    targetGradeLevelId: formData.get("targetGradeLevelId"),
    targetSectionId: formData.get("targetSectionId") || undefined,
    targetTeacherId: formData.get("targetTeacherId"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const { learnerId, targetGradeLevelId, targetSectionId, targetTeacherId } = parsed.data;

  const learner = await prisma.learner.findFirst({
    where: { id: learnerId, deletedAt: null },
  });
  if (!learner) return { ok: false, error: "Learner not found" };

  try {
    assertSameSchool(user.schoolId, learner.schoolId);
  } catch {
    return { ok: false, error: "Not found" };
  }

  const targetGrade = await prisma.gradeLevel.findFirst({
    where: {
      id: targetGradeLevelId,
      schoolId: user.schoolId,
      deletedAt: null,
    },
  });
  if (!targetGrade) return { ok: false, error: "Target grade level not found" };

  const targetTeacher = await prisma.user.findFirst({
    where: {
      id: targetTeacherId,
      schoolId: user.schoolId,
      role: "TEACHER",
      deletedAt: null,
      taughtGrades: { some: { id: targetGradeLevelId } },
    },
  });
  if (!targetTeacher) {
    return { ok: false, error: "Teacher not found or not assigned to target grade" };
  }

  let resolvedSectionId: string | null = null;
  if (targetSectionId) {
    const section = await prisma.section.findFirst({
      where: {
        id: targetSectionId,
        schoolId: user.schoolId,
        gradeLevelId: targetGradeLevelId,
        deletedAt: null,
      },
    });
    if (!section) return { ok: false, error: "Section not found in target grade" };
    resolvedSectionId = section.id;
  }

  const previousGradeId = learner.gradeLevelId;

  await prisma.$transaction(async (tx) => {
    const active = await tx.enrollment.findFirst({
      where: { learnerId: learner.id, status: "ACTIVE" },
    });

    let schoolYearId = active?.schoolYearId ?? null;
    if (!schoolYearId) {
      const activeYear = await tx.schoolYear.findFirst({
        where: { schoolId: user.schoolId, isActive: true },
      });
      schoolYearId = activeYear?.id ?? null;
    }

    if (active) {
      await tx.enrollment.update({
        where: { id: active.id },
        data: { status: "TRANSFERRED", endedAt: new Date() },
      });
    }

    await tx.learner.update({
      where: { id: learner.id },
      data: {
        gradeLevelId: targetGradeLevelId,
        sectionId: resolvedSectionId,
        teacherId: targetTeacherId,
        archivedAt: null,
      },
    });

    if (schoolYearId) {
      await tx.enrollment.create({
        data: {
          learnerId: learner.id,
          schoolId: user.schoolId,
          schoolYearId,
          gradeLevelId: targetGradeLevelId,
          sectionId: resolvedSectionId,
          teacherId: targetTeacherId,
          status: "ACTIVE",
        },
      });
    }
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.LEARNER_TRANSFER,
    resource: "Learner",
    resourceId: learner.id,
    metadata: {
      schoolId: user.schoolId,
      learnerId: learner.id,
      fromGradeLevelId: previousGradeId,
      toGradeLevelId: targetGradeLevelId,
      toSectionId: resolvedSectionId,
      toTeacherId: targetTeacherId,
    },
  });

  revalidatePath(`/teacher/grade/${previousGradeId}`);
  revalidatePath(`/teacher/grade/${targetGradeLevelId}`);
  revalidatePath(`/school-head`);
  return { ok: true };
}

/**
 * SUPER_ADMIN only: move a learner to another school's grade/section/teacher.
 * Ends ACTIVE enrollment as TRANSFERRED; creates new ACTIVE enrollment in the
 * target school's active school year when one exists (otherwise pointers only).
 */
export async function transferLearnerCrossSchool(
  formData: FormData
): Promise<ActionResult> {
  const user = await requireUser("SUPER_ADMIN");

  const parsed = transferLearnerCrossSchoolSchema.safeParse({
    learnerId: formData.get("learnerId"),
    targetSchoolId: formData.get("targetSchoolId"),
    targetGradeLevelId: formData.get("targetGradeLevelId"),
    targetSectionId: formData.get("targetSectionId") || undefined,
    targetTeacherId: formData.get("targetTeacherId"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const {
    learnerId,
    targetSchoolId,
    targetGradeLevelId,
    targetSectionId,
    targetTeacherId,
  } = parsed.data;

  const learner = await prisma.learner.findFirst({
    where: { id: learnerId, deletedAt: null },
  });
  if (!learner) return { ok: false, error: "Learner not found" };

  const fromSchoolId = learner.schoolId;
  if (fromSchoolId === targetSchoolId) {
    return {
      ok: false,
      error: "Use same-school transfer when the learner stays at the same school",
    };
  }

  const targetSchool = await prisma.school.findFirst({
    where: { id: targetSchoolId, deletedAt: null, isActive: true },
  });
  if (!targetSchool) return { ok: false, error: "Target school not found or inactive" };

  const targetGrade = await prisma.gradeLevel.findFirst({
    where: {
      id: targetGradeLevelId,
      schoolId: targetSchoolId,
      deletedAt: null,
    },
  });
  if (!targetGrade) {
    return { ok: false, error: "Target grade level not found in destination school" };
  }

  const targetTeacher = await prisma.user.findFirst({
    where: {
      id: targetTeacherId,
      schoolId: targetSchoolId,
      role: "TEACHER",
      deletedAt: null,
      isActive: true,
      taughtGrades: { some: { id: targetGradeLevelId } },
    },
  });
  if (!targetTeacher) {
    return {
      ok: false,
      error: "Teacher not found or not assigned to target grade in destination school",
    };
  }

  let resolvedSectionId: string | null = null;
  if (targetSectionId) {
    const section = await prisma.section.findFirst({
      where: {
        id: targetSectionId,
        schoolId: targetSchoolId,
        gradeLevelId: targetGradeLevelId,
        deletedAt: null,
      },
    });
    if (!section) {
      return { ok: false, error: "Section not found in destination grade" };
    }
    resolvedSectionId = section.id;
  }

  const previousGradeId = learner.gradeLevelId;

  await prisma.$transaction(async (tx) => {
    const active = await tx.enrollment.findFirst({
      where: { learnerId: learner.id, status: "ACTIVE" },
    });

    if (active) {
      await tx.enrollment.update({
        where: { id: active.id },
        data: { status: "TRANSFERRED", endedAt: new Date() },
      });
    }

    const activeYear = await tx.schoolYear.findFirst({
      where: { schoolId: targetSchoolId, isActive: true },
    });

    await tx.learner.update({
      where: { id: learner.id },
      data: {
        schoolId: targetSchoolId,
        gradeLevelId: targetGradeLevelId,
        sectionId: resolvedSectionId,
        teacherId: targetTeacherId,
        archivedAt: null,
      },
    });

    if (activeYear) {
      await tx.enrollment.create({
        data: {
          learnerId: learner.id,
          schoolId: targetSchoolId,
          schoolYearId: activeYear.id,
          gradeLevelId: targetGradeLevelId,
          sectionId: resolvedSectionId,
          teacherId: targetTeacherId,
          status: "ACTIVE",
        },
      });
    }
  });

  await writeAudit({
    userId: user.id,
    schoolId: targetSchoolId,
    action: AUDIT_ACTIONS.LEARNER_TRANSFER_CROSS_SCHOOL,
    resource: "Learner",
    resourceId: learner.id,
    metadata: {
      learnerId: learner.id,
      fromSchoolId,
      toSchoolId: targetSchoolId,
      fromGradeLevelId: previousGradeId,
      toGradeLevelId: targetGradeLevelId,
      toSectionId: resolvedSectionId,
      toTeacherId: targetTeacherId,
    },
  });

  revalidatePath(`/teacher/grade/${previousGradeId}`);
  revalidatePath(`/teacher/grade/${targetGradeLevelId}`);
  revalidatePath("/admin/transfers");
  revalidatePath("/admin/schools");
  revalidatePath("/school-head");
  return { ok: true };
}
