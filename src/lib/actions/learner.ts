"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import { assertSameSchool } from "@/lib/auth/tenant";
import {
  learnerCreateSchema,
  learnerUpdateSchema,
  learnerIdSchema,
  enrollLearnersToAralSchema,
} from "@/lib/validators/learner.schema";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { normalizePersonName } from "@/lib/learners/normalize";
import { revalidateLearnerScoped } from "@/lib/cache/revalidate";

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string; data?: T };

/** Normalize optional Section B for Prisma (clear transferDetails unless MULTIPLE). */
function sectionBData(data: {
  modeOfTransportation?: "WALKING" | "MOTORCYCLE" | "BUS_JEEP_CAR";
  distanceHomeToSchool?: "LESS_THAN_1KM" | "ONE_TO_FIVE_KM" | "MORE_THAN_5KM";
  previousTransfers?: "NONE" | "ONE" | "MULTIPLE";
  transferDetails?: string;
}) {
  return {
    modeOfTransportation: data.modeOfTransportation ?? null,
    distanceHomeToSchool: data.distanceHomeToSchool ?? null,
    previousTransfers: data.previousTransfers ?? null,
    transferDetails:
      data.previousTransfers === "MULTIPLE" ? (data.transferDetails?.trim() || null) : null,
  };
}

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
      obj[k] = v;
    }
  }
  return obj;
}

function buildFullName(firstName: string, middleName: string | undefined, lastName: string): string {
  return [firstName, middleName, lastName].filter(Boolean).join(" ");
}

/** Validate optional section belongs to grade + school and is not soft-deleted. */
async function resolveSectionForGrade(
  sectionId: string | undefined,
  gradeLevelId: string,
  schoolId: string
): Promise<{ ok: true; sectionId: string | null } | { ok: false; error: string }> {
  if (!sectionId) return { ok: true, sectionId: null };
  const section = await prisma.section.findFirst({
    where: {
      id: sectionId,
      schoolId,
      gradeLevelId,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (!section) return { ok: false, error: "Section not found in this grade" };
  return { ok: true, sectionId: section.id };
}

export async function createLearner(
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  const user = await requireSchoolUser("TEACHER");
  if (!user.profileCompleted) return { ok: false, error: "Complete your profile first" };

  const raw = formToObj(formData);

  const parsed = learnerCreateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const grade = await prisma.gradeLevel.findFirst({
    where: {
      id: parsed.data.gradeLevelId,
      schoolId: user.schoolId,
      deletedAt: null,
      teachers: { some: { id: user.id } },
    },
  });
  if (!grade) return { ok: false, error: "You are not assigned to this grade level" };

  const sectionResult = await resolveSectionForGrade(
    parsed.data.sectionId,
    parsed.data.gradeLevelId,
    user.schoolId
  );
  if (!sectionResult.ok) return sectionResult;

  const firstName = parsed.data.firstName.trim();
  const lastName = parsed.data.lastName.trim();
  const middleName = parsed.data.middleName?.trim() || undefined;

  if (!parsed.data.confirmDuplicate) {
    const candidates = await prisma.learner.findMany({
      where: {
        schoolId: user.schoolId,
        deletedAt: null,
        age: parsed.data.age,
        firstName: { equals: firstName, mode: "insensitive" },
        lastName: { equals: lastName, mode: "insensitive" },
      },
      select: { id: true, firstName: true, lastName: true, fullName: true, age: true },
      take: 10,
    });
    const duplicates = candidates.filter(
      (c) =>
        normalizePersonName(c.firstName) === normalizePersonName(firstName) &&
        normalizePersonName(c.lastName) === normalizePersonName(lastName)
    );
    if (duplicates.length > 0) {
      return {
        ok: false,
        error: "possible_duplicate",
        data: {
          id: duplicates[0].id,
        },
      };
    }
  }

  const activeYear = await prisma.schoolYear.findFirst({
    where: { schoolId: user.schoolId, isActive: true },
  });

  const fullName = buildFullName(firstName, middleName, lastName);

  const learner = await prisma.$transaction(async (tx) => {
    const created = await tx.learner.create({
      data: {
        schoolId: user.schoolId,
        gradeLevelId: parsed.data.gradeLevelId,
        sectionId: sectionResult.sectionId,
        teacherId: user.id,
        firstName,
        middleName,
        lastName,
        fullName,
        age: parsed.data.age,
        gender: parsed.data.gender,
        englishReadingProfile: parsed.data.englishReadingProfile,
        englishFrustrationSubtypes: parsed.data.englishFrustrationSubtypes,
        filipinoReadingProfile: parsed.data.filipinoReadingProfile,
        filipinoFrustrationSubtypes: parsed.data.filipinoFrustrationSubtypes,
        governmentBenefits: parsed.data.governmentBenefits,
        parentEducation: parsed.data.parentEducation,
        ...sectionBData(parsed.data),
        isAralLearner: false,
        aralEnrolledAt: null,
      },
    });

    if (activeYear) {
      await tx.enrollment.create({
        data: {
          learnerId: created.id,
          schoolId: user.schoolId,
          schoolYearId: activeYear.id,
          gradeLevelId: created.gradeLevelId,
          sectionId: created.sectionId,
          teacherId: user.id,
          status: "ACTIVE",
        },
      });
    }

    return created;
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.LEARNER_CREATE,
    resource: "Learner",
    resourceId: learner.id,
    metadata: {
      schoolId: user.schoolId,
      learnerId: learner.id,
      gradeLevelId: learner.gradeLevelId,
      enrollmentCreated: Boolean(activeYear),
    },
  });

  revalidatePath(`/teacher/grade/${parsed.data.gradeLevelId}`);
  revalidatePath("/teacher/learners");
  revalidateLearnerScoped({
    schoolId: user.schoolId,
    teacherId: user.id,
    adminDashboard: true,
  });
  return { ok: true, data: { id: learner.id } };
}

export async function updateLearner(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("TEACHER");
  const raw = formToObj(formData);
  const parsed = learnerUpdateSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const learner = await prisma.learner.findFirst({
    where: { id: parsed.data.id, deletedAt: null },
  });
  if (!learner) return { ok: false, error: "Learner not found" };

  try {
    assertSameSchool(user.schoolId, learner.schoolId);
  } catch {
    return { ok: false, error: "Not found" };
  }
  if (learner.teacherId !== user.id) return { ok: false, error: "Not found" };

  const sectionResult = await resolveSectionForGrade(
    parsed.data.sectionId,
    learner.gradeLevelId,
    user.schoolId
  );
  if (!sectionResult.ok) return sectionResult;

  const firstName = parsed.data.firstName.trim();
  const lastName = parsed.data.lastName.trim();
  const middleName = parsed.data.middleName?.trim() || undefined;
  const fullName = buildFullName(firstName, middleName, lastName);

  // Form only manages 4Ps; preserve any existing IPS flag (no longer offered in UI).
  const governmentBenefits = [
    ...(parsed.data.governmentBenefits.includes("FOUR_PS")
      ? (["FOUR_PS"] as const)
      : []),
    ...(learner.governmentBenefits.includes("IPS") ? (["IPS"] as const) : []),
  ];

  await prisma.$transaction(async (tx) => {
    await tx.learner.update({
      where: { id: learner.id },
      data: {
        firstName,
        middleName,
        lastName,
        fullName,
        age: parsed.data.age,
        gender: parsed.data.gender,
        englishReadingProfile: parsed.data.englishReadingProfile,
        englishFrustrationSubtypes: parsed.data.englishFrustrationSubtypes,
        filipinoReadingProfile: parsed.data.filipinoReadingProfile,
        filipinoFrustrationSubtypes: parsed.data.filipinoFrustrationSubtypes,
        governmentBenefits,
        parentEducation: parsed.data.parentEducation,
        ...sectionBData(parsed.data),
        sectionId: sectionResult.sectionId,
      },
    });

    const active = await tx.enrollment.findFirst({
      where: { learnerId: learner.id, status: "ACTIVE" },
    });
    if (active && active.sectionId !== sectionResult.sectionId) {
      await tx.enrollment.update({
        where: { id: active.id },
        data: { sectionId: sectionResult.sectionId },
      });
    }
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.LEARNER_UPDATE,
    resource: "Learner",
    resourceId: learner.id,
    metadata: {
      schoolId: user.schoolId,
      learnerId: learner.id,
      sectionId: sectionResult.sectionId,
    },
  });

  revalidatePath(`/teacher/grade/${learner.gradeLevelId}`);
  revalidatePath(`/teacher/grade/${learner.gradeLevelId}/learners/${learner.id}`);
  revalidatePath("/teacher/learners");
  revalidateLearnerScoped({
    schoolId: learner.schoolId,
    teacherId: learner.teacherId,
  });
  return { ok: true };
}

export async function archiveLearner(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("TEACHER");
  const parsed = learnerIdSchema.safeParse({ id: formData.get("id") ?? formData.get("learnerId") });
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };

  const learner = await prisma.learner.findFirst({
    where: { id: parsed.data.id, deletedAt: null },
  });
  if (!learner) return { ok: false, error: "Learner not found" };

  try {
    assertSameSchool(user.schoolId, learner.schoolId);
  } catch {
    return { ok: false, error: "Not found" };
  }
  if (learner.teacherId !== user.id) return { ok: false, error: "Not found" };
  if (learner.archivedAt) return { ok: false, error: "Learner is already archived" };

  await prisma.$transaction(async (tx) => {
    await tx.learner.update({
      where: { id: learner.id },
      data: { archivedAt: new Date() },
    });

    const active = await tx.enrollment.findFirst({
      where: { learnerId: learner.id, status: "ACTIVE" },
    });
    if (active) {
      await tx.enrollment.update({
        where: { id: active.id },
        data: { status: "ARCHIVED", endedAt: new Date() },
      });
    }
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.LEARNER_ARCHIVE,
    resource: "Learner",
    resourceId: learner.id,
    metadata: { schoolId: user.schoolId, learnerId: learner.id },
  });

  revalidatePath(`/teacher/grade/${learner.gradeLevelId}`);
  revalidatePath(`/teacher/aral/${learner.gradeLevelId}`);
  revalidatePath(`/teacher/grade/${learner.gradeLevelId}/learners/${learner.id}`);
  revalidatePath("/teacher/learners");
  revalidatePath("/teacher/aral");
  revalidateLearnerScoped({
    schoolId: learner.schoolId,
    teacherId: learner.teacherId,
    adminDashboard: true,
    teacherShell: learner.isAralLearner,
  });
  return { ok: true };
}

export async function restoreLearner(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("TEACHER");
  const parsed = learnerIdSchema.safeParse({ id: formData.get("id") ?? formData.get("learnerId") });
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };

  const learner = await prisma.learner.findFirst({
    where: { id: parsed.data.id, deletedAt: null },
  });
  if (!learner) return { ok: false, error: "Learner not found" };

  try {
    assertSameSchool(user.schoolId, learner.schoolId);
  } catch {
    return { ok: false, error: "Not found" };
  }
  if (learner.teacherId !== user.id) return { ok: false, error: "Not found" };
  if (!learner.archivedAt) return { ok: false, error: "Learner is not archived" };

  await prisma.$transaction(async (tx) => {
    await tx.learner.update({
      where: { id: learner.id },
      data: { archivedAt: null },
    });

    const existingActive = await tx.enrollment.findFirst({
      where: { learnerId: learner.id, status: "ACTIVE" },
    });
    if (existingActive) return;

    const activeYear = await tx.schoolYear.findFirst({
      where: { schoolId: learner.schoolId, isActive: true },
    });
    if (!activeYear) return;

    const archivedEnrollment = await tx.enrollment.findFirst({
      where: {
        learnerId: learner.id,
        schoolYearId: activeYear.id,
        status: "ARCHIVED",
      },
      orderBy: { endedAt: "desc" },
    });

    if (archivedEnrollment) {
      await tx.enrollment.update({
        where: { id: archivedEnrollment.id },
        data: { status: "ACTIVE", endedAt: null },
      });
    } else {
      await tx.enrollment.create({
        data: {
          learnerId: learner.id,
          schoolId: learner.schoolId,
          schoolYearId: activeYear.id,
          gradeLevelId: learner.gradeLevelId,
          sectionId: learner.sectionId,
          teacherId: learner.teacherId,
          status: "ACTIVE",
        },
      });
    }
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.LEARNER_RESTORE,
    resource: "Learner",
    resourceId: learner.id,
    metadata: { schoolId: user.schoolId, learnerId: learner.id },
  });

  revalidatePath(`/teacher/grade/${learner.gradeLevelId}`);
  revalidatePath(`/teacher/aral/${learner.gradeLevelId}`);
  revalidatePath(`/teacher/grade/${learner.gradeLevelId}/learners/${learner.id}`);
  revalidatePath("/teacher/learners");
  revalidatePath("/teacher/aral");
  revalidateLearnerScoped({
    schoolId: learner.schoolId,
    teacherId: learner.teacherId,
    adminDashboard: true,
    teacherShell: learner.isAralLearner,
  });
  return { ok: true };
}

export async function toggleAralLearner(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("TEACHER");
  const learnerId = String(formData.get("learnerId") ?? "");
  if (!learnerId) return { ok: false, error: "Missing id" };

  const learner = await prisma.learner.findFirst({
    where: { id: learnerId, deletedAt: null },
  });
  if (!learner) return { ok: false, error: "Learner not found" };

  try {
    assertSameSchool(user.schoolId, learner.schoolId);
  } catch {
    return { ok: false, error: "Not found" };
  }
  if (learner.teacherId !== user.id) return { ok: false, error: "Not found" };

  const becoming = !learner.isAralLearner;
  await prisma.learner.update({
    where: { id: learner.id },
    data: {
      isAralLearner: becoming,
      aralEnrolledAt: becoming ? new Date() : null,
    },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.LEARNER_TOGGLE_ARAL,
    resource: "Learner",
    resourceId: learner.id,
    metadata: {
      schoolId: user.schoolId,
      learnerId: learner.id,
      isAralLearner: becoming,
    },
  });

  revalidatePath(`/teacher/grade/${learner.gradeLevelId}`);
  revalidatePath(`/teacher/aral/${learner.gradeLevelId}`);
  revalidatePath(`/teacher/grade/${learner.gradeLevelId}/learners/${learner.id}`);
  revalidatePath("/teacher/learners");
  revalidatePath("/teacher/aral");
  // ARAL flag changes sidebar hasAral; do not bust adminDashboard for toggles.
  revalidateLearnerScoped({
    schoolId: learner.schoolId,
    teacherId: learner.teacherId,
    teacherShell: true,
  });
  return { ok: true };
}

/**
 * Enroll already-rostered learners into ARAL for a grade.
 * Sets `isAralLearner` + `aralEnrolledAt` (idempotent for already-enrolled).
 */
export async function enrollLearnersToAral(
  input: unknown
): Promise<ActionResult<{ enrolled: number }>> {
  const user = await requireSchoolUser("TEACHER");
  if (!user.profileCompleted) return { ok: false, error: "Complete your profile first" };

  const parsed = enrollLearnersToAralSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const grade = await prisma.gradeLevel.findFirst({
    where: {
      id: parsed.data.gradeId,
      schoolId: user.schoolId,
      deletedAt: null,
      teachers: { some: { id: user.id } },
    },
    select: { id: true },
  });
  if (!grade) return { ok: false, error: "You are not assigned to this grade level" };

  const uniqueIds = [...new Set(parsed.data.learnerIds)];
  const learners = await prisma.learner.findMany({
    where: {
      id: { in: uniqueIds },
      schoolId: user.schoolId,
      gradeLevelId: grade.id,
      teacherId: user.id,
      deletedAt: null,
      archivedAt: null,
    },
    select: { id: true, isAralLearner: true },
  });

  if (learners.length !== uniqueIds.length) {
    return { ok: false, error: "One or more learners were not found in this grade" };
  }

  const toEnroll = learners.filter((l) => !l.isAralLearner).map((l) => l.id);
  const enrolledAt = new Date();

  if (toEnroll.length > 0) {
    await prisma.learner.updateMany({
      where: { id: { in: toEnroll } },
      data: {
        isAralLearner: true,
        aralEnrolledAt: enrolledAt,
      },
    });
  }

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.LEARNER_ENROLL_ARAL,
    resource: "Learner",
    resourceId: grade.id,
    metadata: {
      schoolId: user.schoolId,
      gradeLevelId: grade.id,
      learnerIds: toEnroll,
      enrolled: toEnroll.length,
      requested: uniqueIds.length,
    },
  });

  revalidatePath(`/teacher/grade/${grade.id}`);
  revalidatePath(`/teacher/aral/${grade.id}`);
  revalidatePath("/teacher/learners");
  revalidatePath("/teacher/aral");
  revalidateLearnerScoped({
    schoolId: user.schoolId,
    teacherId: user.id,
    teacherShell: true,
  });

  return { ok: true, data: { enrolled: toEnroll.length } };
}
