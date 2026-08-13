"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser, requireUser } from "@/lib/auth/session";
import { assertSameSchool } from "@/lib/auth/tenant";
import {
  transferLearnerSchema,
  transferLearnerCrossSchoolSchema,
  SECTION_CLEAR,
  GRADE_FLOATING,
} from "@/lib/validators/enrollment.schema";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { ensureFloatingGradeLevel } from "@/lib/grades/floating";
import {
  revalidateSchoolDashboard,
  revalidateSchoolsList,
  revalidateTeacherCaches,
} from "@/lib/cache/revalidate";

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Resolve transfer section:
 * - `__none__` → clear (null)
 * - uuid → validate against target grade + school
 * - omitted: same-grade → preserve previous; cross-grade → null
 */
async function resolveTransferSection(params: {
  targetSectionId: string | undefined;
  targetGradeLevelId: string;
  schoolId: string;
  previousSectionId: string | null;
  previousGradeLevelId: string;
  /** When false (cross-school), omit always clears. */
  preserveOnSameGradeOmit?: boolean;
}): Promise<{ ok: true; sectionId: string | null } | { ok: false; error: string }> {
  const {
    targetSectionId,
    targetGradeLevelId,
    schoolId,
    previousSectionId,
    previousGradeLevelId,
    preserveOnSameGradeOmit = true,
  } = params;

  if (targetSectionId === SECTION_CLEAR) {
    return { ok: true, sectionId: null };
  }

  if (targetSectionId) {
    const section = await prisma.section.findFirst({
      where: {
        id: targetSectionId,
        schoolId,
        gradeLevelId: targetGradeLevelId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!section) return { ok: false, error: "Section not found in target grade" };
    return { ok: true, sectionId: section.id };
  }

  // Omitted: preserve only when same grade (previous section still valid for target).
  if (
    preserveOnSameGradeOmit &&
    previousGradeLevelId === targetGradeLevelId &&
    previousSectionId
  ) {
    const stillValid = await prisma.section.findFirst({
      where: {
        id: previousSectionId,
        schoolId,
        gradeLevelId: targetGradeLevelId,
        deletedAt: null,
      },
      select: { id: true },
    });
    return { ok: true, sectionId: stillValid?.id ?? null };
  }

  return { ok: true, sectionId: null };
}

/**
 * Same-school transfer: grade and/or section and/or teacher.
 */
export async function transferLearner(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const rawSection = formData.get("targetSectionId");
  const parsed = transferLearnerSchema.safeParse({
    learnerId: formData.get("learnerId"),
    targetGradeLevelId: formData.get("targetGradeLevelId"),
    // Preserve distinction: missing key → undefined; "__none__" → clear
    targetSectionId: rawSection === null ? undefined : rawSection,
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

  // Floating means "no grade and no section". The FLOATING `GradeLevel` row that
  // backs it is created on demand, so the form sends the GRADE_FLOATING sentinel
  // rather than an id. Accept a real FLOATING id too, in case the row already
  // exists and something sends it directly — the type, not the shape of the
  // input, decides whether this is a floating placement.
  let toFloating = targetGradeLevelId === GRADE_FLOATING;
  let resolvedGradeLevelId: string;

  if (toFloating) {
    resolvedGradeLevelId = await ensureFloatingGradeLevel(prisma, user.schoolId);
  } else {
    const targetGrade = await prisma.gradeLevel.findFirst({
      where: {
        id: targetGradeLevelId,
        schoolId: user.schoolId,
        deletedAt: null,
      },
      select: { id: true, type: true },
    });
    if (!targetGrade) return { ok: false, error: "Target grade level not found" };
    resolvedGradeLevelId = targetGrade.id;
    toFloating = targetGrade.type === "FLOATING";
  }

  // Every non-floating grade still requires a teacher, and that teacher must
  // *advise a section in it* — advisory is one section per teacher now, so the
  // legacy `taughtGrades` m2m is no longer the source of truth for "assigned to
  // this grade". FLOATING has no adviser and no sections by definition.
  let resolvedTeacherId: string | null = null;
  let resolvedSectionId: string | null = null;

  if (toFloating) {
    if (targetTeacherId) {
      return {
        ok: false,
        error: "Floating learners have no adviser — leave the teacher blank.",
      };
    }
    if (targetSectionId && targetSectionId !== SECTION_CLEAR) {
      return { ok: false, error: "Floating learners have no section." };
    }
  } else {
    if (!targetTeacherId) return { ok: false, error: "Target teacher required" };

    const targetTeacher = await prisma.user.findFirst({
      where: {
        id: targetTeacherId,
        schoolId: user.schoolId,
        role: "TEACHER",
        deletedAt: null,
        advisorySection: { gradeLevelId: resolvedGradeLevelId, deletedAt: null },
      },
      select: { id: true },
    });
    if (!targetTeacher) {
      return {
        ok: false,
        error: "Teacher not found or does not advise a section in the target grade",
      };
    }
    resolvedTeacherId = targetTeacher.id;

    const sectionResult = await resolveTransferSection({
      targetSectionId,
      targetGradeLevelId: resolvedGradeLevelId,
      schoolId: user.schoolId,
      previousSectionId: learner.sectionId,
      previousGradeLevelId: learner.gradeLevelId,
      preserveOnSameGradeOmit: true,
    });
    if (!sectionResult.ok) return sectionResult;
    resolvedSectionId = sectionResult.sectionId;
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
        gradeLevelId: resolvedGradeLevelId,
        sectionId: resolvedSectionId,
        teacherId: resolvedTeacherId,
        archivedAt: null,
      },
    });

    if (schoolYearId) {
      await tx.enrollment.create({
        data: {
          learnerId: learner.id,
          schoolId: user.schoolId,
          schoolYearId,
          gradeLevelId: resolvedGradeLevelId,
          sectionId: resolvedSectionId,
          teacherId: resolvedTeacherId,
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
      toGradeLevelId: resolvedGradeLevelId,
      toSectionId: resolvedSectionId,
      toTeacherId: resolvedTeacherId,
      toFloating,
    },
  });

  revalidatePath(`/teacher/grade/${previousGradeId}`);
  revalidatePath(`/teacher/grade/${resolvedGradeLevelId}`);
  revalidatePath(`/teacher/aral/${previousGradeId}`);
  revalidatePath(`/teacher/aral/${resolvedGradeLevelId}`);
  revalidatePath("/teacher/learners");
  revalidatePath("/teacher/aral");
  revalidatePath("/school-head/transfer");
  revalidatePath("/school-head/teachers");
  // A first floating placement creates the FLOATING grade row, which the Grade
  // Levels page renders.
  revalidatePath("/school-head/grade-levels");
  revalidateSchoolDashboard(user.schoolId);
  if (learner.teacherId) revalidateTeacherCaches(learner.teacherId);
  // Null on a transfer into FLOATING — there is no receiving adviser to bust.
  if (resolvedTeacherId && resolvedTeacherId !== learner.teacherId) {
    revalidateTeacherCaches(resolvedTeacherId);
  }
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

  const rawSection = formData.get("targetSectionId");
  const parsed = transferLearnerCrossSchoolSchema.safeParse({
    learnerId: formData.get("learnerId"),
    targetSchoolId: formData.get("targetSchoolId"),
    targetGradeLevelId: formData.get("targetGradeLevelId"),
    targetSectionId: rawSection === null ? undefined : rawSection,
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

  // Advisory is one section per teacher now, so grade membership is derived from
  // the advised section rather than the legacy `taughtGrades` m2m (which nothing
  // writes any more). Cross-school transfer still requires a real receiving
  // adviser — FLOATING is a same-school holding state, not a transfer target.
  const targetTeacher = await prisma.user.findFirst({
    where: {
      id: targetTeacherId,
      schoolId: targetSchoolId,
      role: "TEACHER",
      deletedAt: null,
      isActive: true,
      advisorySection: { gradeLevelId: targetGradeLevelId, deletedAt: null },
    },
    select: { id: true },
  });
  if (!targetTeacher) {
    return {
      ok: false,
      error:
        "Teacher not found or does not advise a section in the target grade at the destination school",
    };
  }

  const sectionResult = await resolveTransferSection({
    targetSectionId,
    targetGradeLevelId,
    schoolId: targetSchoolId,
    previousSectionId: learner.sectionId,
    previousGradeLevelId: learner.gradeLevelId,
    // Cross-school: previous section is never valid at destination
    preserveOnSameGradeOmit: false,
  });
  if (!sectionResult.ok) {
    return {
      ok: false,
      error:
        sectionResult.error === "Section not found in target grade"
          ? "Section not found in destination grade"
          : sectionResult.error,
    };
  }
  const resolvedSectionId = sectionResult.sectionId;

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
  revalidatePath(`/teacher/aral/${previousGradeId}`);
  revalidatePath(`/teacher/aral/${targetGradeLevelId}`);
  revalidatePath("/teacher/learners");
  revalidatePath("/teacher/aral");
  revalidatePath("/admin/transfers");
  revalidatePath("/admin/schools");
  revalidatePath("/school-head/transfer");
  revalidateSchoolDashboard(fromSchoolId);
  revalidateSchoolDashboard(targetSchoolId);
  revalidateSchoolsList();
  if (learner.teacherId) revalidateTeacherCaches(learner.teacherId);
  revalidateTeacherCaches(targetTeacherId);
  return { ok: true };
}
