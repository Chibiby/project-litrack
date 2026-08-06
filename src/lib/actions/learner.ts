"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import { assertSameSchool } from "@/lib/auth/tenant";
import {
  learnerCreateSchema,
  learnerUpdateSchema,
  learnerIdSchema,
} from "@/lib/validators/learner.schema";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { normalizePersonName } from "@/lib/learners/normalize";
import { revalidateLearnerScoped } from "@/lib/cache/revalidate";

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string; data?: T };

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

export async function createLearner(
  formData: FormData
): Promise<ActionResult<{ id: string }>> {
  const user = await requireSchoolUser("TEACHER");
  if (!user.profileCompleted) return { ok: false, error: "Complete your profile first" };

  const raw = formToObj(formData);
  raw.isAralLearner =
    raw.isAralLearner === "on" || raw.isAralLearner === "true" || raw.isAralLearner === true;

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
        isAralLearner: parsed.data.isAralLearner ?? false,
        aralEnrolledAt: parsed.data.isAralLearner ? new Date() : null,
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
  revalidateLearnerScoped({ schoolId: user.schoolId, teacherId: user.id });
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

  const firstName = parsed.data.firstName.trim();
  const lastName = parsed.data.lastName.trim();
  const middleName = parsed.data.middleName?.trim() || undefined;
  const fullName = buildFullName(firstName, middleName, lastName);

  await prisma.learner.update({
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
      governmentBenefits: parsed.data.governmentBenefits,
      parentEducation: parsed.data.parentEducation,
    },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.LEARNER_UPDATE,
    resource: "Learner",
    resourceId: learner.id,
    metadata: { schoolId: user.schoolId, learnerId: learner.id },
  });

  revalidatePath(`/teacher/grade/${learner.gradeLevelId}`);
  revalidatePath(`/teacher/grade/${learner.gradeLevelId}/learners/${learner.id}`);
  revalidateLearnerScoped({ schoolId: learner.schoolId, teacherId: learner.teacherId });
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
  revalidateLearnerScoped({ schoolId: learner.schoolId, teacherId: learner.teacherId });
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
  revalidateLearnerScoped({ schoolId: learner.schoolId, teacherId: learner.teacherId });
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
  revalidateLearnerScoped({ schoolId: learner.schoolId, teacherId: learner.teacherId });
  return { ok: true };
}
