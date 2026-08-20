"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import { assertSameSchool } from "@/lib/auth/tenant";
import {
  learnerCreateSchema,
  learnerUpdateSchema,
  learnerIdSchema,
  deleteLearnersSchema,
  enrollLearnersToAralSchema,
  enrollRosterLearnersToAralSchema,
} from "@/lib/validators/learner.schema";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { normalizePersonName } from "@/lib/learners/normalize";
import {
  revalidateLearnerScoped,
  revalidateSchoolHeadTeachers,
} from "@/lib/cache/revalidate";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import {
  teacherAdvisoryGradeScope,
  teacherCanAccessLearner,
  teacherLearnerScope,
} from "@/lib/teachers/scope";
import {
  getAdvisoryPlacement,
  NO_ADVISORY_MESSAGE,
} from "@/lib/teachers/advisory";
import { isEligibleAralTutor } from "@/lib/teachers/aral-tutor";
import { notifyAralAssigned } from "@/lib/notifications";

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

/** Normalize ethnicity for Prisma (clear free text unless OTHER). */
function ethnicityData(data: {
  ethnicity?:
    | "BISAYA" | "ILONGGO" | "BLAAN" | "TAGAKAOLO" | "TBOLI" | "BADJAO" | "MARANAO"
    | "TAUSOG" | "MAGUINDANAON" | "ILOCANO" | "TAGALOG" | "FOREIGN" | "OTHER";
  ethnicityOther?: string;
}) {
  return {
    ethnicity: data.ethnicity ?? null,
    ethnicityOther:
      data.ethnicity === "OTHER" ? (data.ethnicityOther?.trim() || null) : null,
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

  // Placement is DERIVED from the section this teacher advises, never submitted.
  // The dropdowns that used to send it were built from the ARAL-inclusive grade
  // list while this action validated against the advisory-only one, so every
  // teacher who also tutored ARAL learners was offered a grade the action then
  // refused — and the modal could open pre-set to it.
  const advisory = await getAdvisoryPlacement(user);
  if (!advisory) return { ok: false, error: NO_ADVISORY_MESSAGE };

  // A stale client can still post the grade it was showing. Refuse rather than
  // quietly rerouting the learner into a grade the teacher never chose.
  if (
    parsed.data.gradeLevelId &&
    parsed.data.gradeLevelId !== advisory.gradeLevelId
  ) {
    return { ok: false, error: "You are not assigned to this grade level" };
  }

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
        gradeLevelId: advisory.gradeLevelId,
        sectionId: advisory.sectionId,
        teacherId: user.id,
        firstName,
        middleName,
        lastName,
        fullName,
        age: parsed.data.age,
        gender: parsed.data.gender,
        ...ethnicityData(parsed.data),
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
      sectionId: learner.sectionId,
      enrollmentCreated: Boolean(activeYear),
    },
  });

  revalidatePath(`/teacher/grade/${advisory.gradeLevelId}`);
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
  if (!teacherCanAccessLearner(learner, user.id)) {
    return { ok: false, error: "Not found" };
  }

  // Placement is not editable here. The edit form no longer offers a section, and
  // moving a learner between sections is the School Head's transfer flow — not a
  // side effect of correcting a spelling. Any `sectionId` in the payload is
  // ignored rather than trusted.
  const sectionId = learner.sectionId;

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
        ...ethnicityData(parsed.data),
        ...sectionBData(parsed.data),
      },
    });

    // No enrollment write. The learner's section is untouched above, so the active
    // Enrollment row already points where it should — the reconcile that used to
    // live here existed only because this action could move a learner.
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
      sectionId,
    },
  });

  revalidatePath(`/teacher/grade/${learner.gradeLevelId}`);
  revalidatePath(`/teacher/grade/${learner.gradeLevelId}/learners/${learner.id}`);
  revalidatePath("/teacher/learners");
  revalidateLearnerScoped({
    schoolId: learner.schoolId,
    teacherId: learner.teacherId,
    aralTeacherId: learner.aralTeacherId,
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
  if (!teacherCanAccessLearner(learner, user.id)) {
    return { ok: false, error: "Not found" };
  }
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
    aralTeacherId: learner.aralTeacherId,
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
  if (!teacherCanAccessLearner(learner, user.id)) {
    return { ok: false, error: "Not found" };
  }
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
    aralTeacherId: learner.aralTeacherId,
    adminDashboard: true,
    teacherShell: learner.isAralLearner,
  });
  return { ok: true };
}

/**
 * Bulk soft-delete from the roster selection bar.
 *
 * Sets `deletedAt`, which every learner query in the app already filters on, so
 * the learners drop out of lists, counts, exports and reports at once. Their
 * attendance, reading-level history and ARAL profile rows are deliberately left
 * intact — this is the reversible delete the schema was designed for, not a
 * cascade.
 *
 * The batch is all-or-nothing: if any selected id is outside the caller's
 * school or care, nothing is deleted. A partial success here would silently
 * misreport what the teacher just did.
 */
export async function deleteLearners(
  formData: FormData
): Promise<ActionResult<{ deleted: number }>> {
  const user = await requireSchoolUser("TEACHER");
  const parsed = deleteLearnersSchema.safeParse({
    learnerIds: formData.getAll("learnerIds").map(String),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.errors[0]?.message ?? "Invalid input",
    };
  }

  const ids = Array.from(new Set(parsed.data.learnerIds));
  const learners = await prisma.learner.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: {
      id: true,
      schoolId: true,
      teacherId: true,
      aralTeacherId: true,
      gradeLevelId: true,
      isAralLearner: true,
    },
  });

  if (learners.length !== ids.length) {
    return { ok: false, error: "Some selected learners were not found" };
  }
  for (const learner of learners) {
    if (learner.schoolId !== user.schoolId) {
      return { ok: false, error: "Not found" };
    }
    if (!teacherCanAccessLearner(learner, user.id)) {
      return { ok: false, error: "Not found" };
    }
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.learner.updateMany({
      where: { id: { in: ids } },
      data: { deletedAt: now },
    });
    // End the active enrollment too, so the learner does not keep a live seat
    // in the school year they were removed from.
    await tx.enrollment.updateMany({
      where: { learnerId: { in: ids }, status: "ACTIVE" },
      data: { status: "ARCHIVED", endedAt: now },
    });
  });

  for (const learner of learners) {
    await writeAudit({
      userId: user.id,
      schoolId: user.schoolId,
      action: AUDIT_ACTIONS.LEARNER_DELETE,
      resource: "Learner",
      resourceId: learner.id,
      metadata: { schoolId: user.schoolId, learnerId: learner.id },
    });
  }

  const gradeIds = Array.from(new Set(learners.map((l) => l.gradeLevelId)));
  for (const gradeId of gradeIds) {
    revalidatePath(`/teacher/grade/${gradeId}`);
    revalidatePath(`/teacher/aral/${gradeId}`);
  }
  revalidatePath("/teacher/learners");
  revalidatePath("/teacher/aral");
  for (const learner of learners) {
    revalidateLearnerScoped({
      schoolId: learner.schoolId,
      teacherId: learner.teacherId,
      aralTeacherId: learner.aralTeacherId,
      adminDashboard: true,
      teacherShell: learner.isAralLearner,
    });
  }

  return { ok: true, data: { deleted: learners.length } };
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
  if (!teacherCanAccessLearner(learner, user.id)) {
    return { ok: false, error: "Not found" };
  }

  const becoming = !learner.isAralLearner;
  // Keep the ARAL designation consistent with the flag. Enrolling honours an
  // explicit pick, else falls back to a designation the School Head already made,
  // else to whoever enrolled. Un-enrolling clears it so `aralTeacherId` never
  // grants access to a non-ARAL learner.
  const picked = String(formData.get("aralTeacherId") ?? "").trim();
  if (becoming && picked && picked !== user.id) {
    if (!(await isEligibleAralTutor(picked, user.schoolId))) {
      return { ok: false, error: "Teacher not found" };
    }
  }
  const nextAralTeacherId = becoming
    ? picked || learner.aralTeacherId || user.id
    : null;
  await prisma.learner.update({
    where: { id: learner.id },
    data: {
      isAralLearner: becoming,
      aralEnrolledAt: becoming ? new Date() : null,
      aralTeacherId: nextAralTeacherId,
    },
  });

  if (becoming && nextAralTeacherId) {
    await notifyAralAssigned({
      schoolId: user.schoolId,
      recipientId: nextAralTeacherId,
      actorId: user.id,
      learnerIds: [learner.id],
    });
  }

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
    aralTeacherId: learner.aralTeacherId ?? nextAralTeacherId,
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
): Promise<ActionResult<{ enrolled: number; redesignated: number }>> {
  const user = await requireSchoolUser("TEACHER");
  if (!user.profileCompleted) return { ok: false, error: "Complete your profile first" };

  const parsed = enrollLearnersToAralSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  // Adviser-scoped on purpose: ARAL enrollment picks from the adviser's own
  // roster, so an ARAL-only teacher has nothing to enroll here.
  const grade = await prisma.gradeLevel.findFirst({
    where: {
      id: parsed.data.gradeId,
      schoolId: user.schoolId,
      deletedAt: null,
      ...teacherAdvisoryGradeScope(user.id),
    },
    select: { id: true },
  });
  if (!grade) return { ok: false, error: "You are not assigned to this grade level" };

  const uniqueIds = [...new Set(parsed.data.learnerIds)];

  // Who tutors them. Any teacher at the school qualifies — DepEd plantilla or
  // not, advisory section or not — because the designation is precisely what lets
  // a volunteer or ARAL-only teacher work on ARAL learners. Omitted means the
  // enrolling adviser keeps them, which is what the picker defaults to.
  const aralTeacherId = parsed.data.aralTeacherId ?? user.id;
  if (
    aralTeacherId !== user.id &&
    !(await isEligibleAralTutor(aralTeacherId, user.schoolId))
  ) {
    return { ok: false, error: "Teacher not found" };
  }

  const learners = await prisma.learner.findMany({
    where: {
      id: { in: uniqueIds },
      schoolId: user.schoolId,
      gradeLevelId: grade.id,
      teacherId: user.id,
      deletedAt: null,
      archivedAt: null,
    },
    select: { id: true, isAralLearner: true, aralTeacherId: true },
  });

  if (learners.length !== uniqueIds.length) {
    return { ok: false, error: "One or more learners were not found in this grade" };
  }

  const toEnroll = learners.filter((l) => !l.isAralLearner).map((l) => l.id);
  // Already in ARAL but tutored by somebody else. The teacher picked a tutor for
  // this whole selection, so honour that for them too rather than silently
  // skipping them — a selection that partly took effect is worse than either
  // outcome.
  const toRedesignate = learners
    .filter((l) => l.isAralLearner && l.aralTeacherId !== aralTeacherId)
    .map((l) => l.id);
  const enrolledAt = new Date();

  // One transaction for both writes. The teacher picked one tutor for one
  // selection; enrolling some learners and then failing to move the rest would
  // leave the roster in a state nobody chose, and the toast counts the two
  // groups separately, so a partial apply would also be misreported.
  if (toEnroll.length > 0 || toRedesignate.length > 0) {
    await prisma.$transaction(async (tx) => {
      if (toEnroll.length > 0) {
        await tx.learner.updateMany({
          where: { id: { in: toEnroll } },
          data: {
            isAralLearner: true,
            aralEnrolledAt: enrolledAt,
            aralTeacherId,
          },
        });
      }

      if (toRedesignate.length > 0) {
        await tx.learner.updateMany({
          where: { id: { in: toRedesignate } },
          data: { aralTeacherId },
        });
      }
    });
  }

  // One message per action, not per learner: enrolling twelve learners at once
  // tells the tutor once. Self-assignment writes nothing.
  await notifyAralAssigned({
    schoolId: user.schoolId,
    recipientId: aralTeacherId,
    actorId: user.id,
    learnerIds: [...toEnroll, ...toRedesignate],
  });

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
      redesignated: toRedesignate.length,
      aralTeacherId,
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
  // The designated tutor's own sidebar and metrics are derived from the learners
  // they track, so a designation to somebody else has to bust their caches too.
  if (aralTeacherId !== user.id) {
    revalidateLearnerScoped({
      schoolId: user.schoolId,
      aralTeacherId,
      teacherShell: true,
    });
  }

  // Both counts, because the caller reports them separately: a selection that
  // enrolled nobody may still have moved learners to a new tutor, and "already
  // in ARAL" would be the wrong thing to say about that.
  return {
    ok: true,
    data: { enrolled: toEnroll.length, redesignated: toRedesignate.length },
  };
}

/**
 * Enroll learners picked on the teacher roster into ARAL, and/or hand
 * already-enrolled ones to a different ARAL tutor.
 *
 * A sibling of `enrollLearnersToAral` rather than a wrapper around it. That
 * action is scoped to one grade the caller *advises*, which is exactly right for
 * the ARAL grade page and wrong here: the roster spans every grade the teacher
 * holds and includes learners they reach only through an ARAL designation. Nor
 * can this call it once per grade — a teacher who enrolls twelve learners in one
 * gesture would get one notification and one audit row per grade for a single act.
 *
 * Assigns and reassigns; it never clears. Clearing a designation is the School
 * Head's call (`setLearnerAralTeacher`), because the designation is what grants an
 * ARAL-only teacher their access, and revoking it is not a roster operation.
 */
export async function enrollRosterLearnersToAral(
  input: unknown
): Promise<ActionResult<{ enrolled: number; redesignated: number }>> {
  const user = await requireSchoolUser("TEACHER");
  if (!user.profileCompleted) return { ok: false, error: "Complete your profile first" };

  const parsed = enrollRosterLearnersToAralSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const uniqueIds = [...new Set(parsed.data.learnerIds)];

  // Any teacher at the school qualifies — DepEd plantilla or not, advisory
  // section or not — because the designation is precisely what lets a volunteer
  // or ARAL-only teacher work on ARAL learners. Omitted means the caller keeps
  // them, which is what the picker defaults to.
  const aralTeacherId = parsed.data.aralTeacherId ?? user.id;
  if (
    aralTeacherId !== user.id &&
    !(await isEligibleAralTutor(aralTeacherId, user.schoolId))
  ) {
    return { ok: false, error: "Teacher not found" };
  }

  const learners = await prisma.learner.findMany({
    where: {
      id: { in: uniqueIds },
      schoolId: user.schoolId,
      deletedAt: null,
      archivedAt: null,
      // Advisory roster + ARAL designations — the same scope the roster lists by,
      // so anything visible there is actionable here and nothing else is.
      ...teacherLearnerScope(user.id),
    },
    select: {
      id: true,
      gradeLevelId: true,
      teacherId: true,
      isAralLearner: true,
      aralTeacherId: true,
    },
  });

  // One generic answer for "not yours", "another school's", "archived" and
  // "never existed", so a probe cannot tell them apart.
  if (learners.length !== uniqueIds.length) {
    return { ok: false, error: "One or more learners are no longer on your roster" };
  }

  const toEnroll = learners.filter((l) => !l.isAralLearner).map((l) => l.id);
  // Already in ARAL but tutored by somebody else. The teacher picked one tutor
  // for this whole selection, so honour it for them too rather than silently
  // skipping them — a selection that partly took effect is worse than either
  // outcome.
  const toRedesignate = learners
    .filter((l) => l.isAralLearner && l.aralTeacherId !== aralTeacherId)
    .map((l) => l.id);

  // Nothing to do: every learner is already in ARAL with this tutor. Returning
  // early keeps the audit log free of a row claiming a change that never
  // happened, and the caller still gets both counts to report from.
  if (toEnroll.length === 0 && toRedesignate.length === 0) {
    return { ok: true, data: { enrolled: 0, redesignated: 0 } };
  }

  const enrolledAt = new Date();

  // One transaction for both writes: the teacher picked one tutor for one
  // selection, and enrolling some while failing to move the rest would leave the
  // roster in a state nobody chose — which the two separate counts would then
  // also misreport.
  await prisma.$transaction(async (tx) => {
    if (toEnroll.length > 0) {
      await tx.learner.updateMany({
        where: { id: { in: toEnroll } },
        data: { isAralLearner: true, aralEnrolledAt: enrolledAt, aralTeacherId },
      });
    }
    if (toRedesignate.length > 0) {
      await tx.learner.updateMany({
        where: { id: { in: toRedesignate } },
        data: { aralTeacherId },
      });
    }
  });

  const affected = [...toEnroll, ...toRedesignate];

  // One message per action, not per learner. Self-assignment writes nothing.
  await notifyAralAssigned({
    schoolId: user.schoolId,
    recipientId: aralTeacherId,
    actorId: user.id,
    learnerIds: affected,
  });

  // Named for what the teacher did: enrolling somebody is an enrolment even when
  // the same gesture also moved others, and a selection that only changed hands
  // is a designation change and reads better in the log under that name.
  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action:
      toEnroll.length > 0
        ? AUDIT_ACTIONS.LEARNER_ENROLL_ARAL
        : AUDIT_ACTIONS.LEARNER_SET_ARAL_TEACHER,
    resource: "Learner",
    resourceId: affected.length === 1 ? affected[0] : null,
    metadata: {
      schoolId: user.schoolId,
      source: "roster",
      learnerIds: affected,
      enrolled: toEnroll.length,
      redesignated: toRedesignate.length,
      aralTeacherId,
      requested: uniqueIds.length,
    },
  });

  // The roster spans grades, so bust each one the selection actually touched
  // rather than the caller's whole set.
  const affectedSet = new Set(affected);
  const gradeIds = [
    ...new Set(
      learners.filter((l) => affectedSet.has(l.id)).map((l) => l.gradeLevelId)
    ),
  ];
  for (const gradeId of gradeIds) {
    revalidatePath(`/teacher/grade/${gradeId}`);
    revalidatePath(`/teacher/aral/${gradeId}`);
  }
  revalidatePath("/teacher/learners");
  revalidatePath("/teacher/aral");

  revalidateLearnerScoped({
    schoolId: user.schoolId,
    teacherId: user.id,
    teacherShell: true,
  });
  // The designated tutor's own sidebar and metrics are derived from the learners
  // they track, so a designation to somebody else has to bust their caches too.
  if (aralTeacherId !== user.id) {
    revalidateLearnerScoped({
      schoolId: user.schoolId,
      aralTeacherId,
      teacherShell: true,
    });
  }
  // The outgoing tutor of a reassigned learner loses them from their own ARAL
  // list, so their caches are just as stale as the incoming tutor's.
  const previousTutorIds = new Set(
    learners
      .filter((l) => affectedSet.has(l.id) && l.aralTeacherId)
      .map((l) => l.aralTeacherId as string)
  );
  for (const previousId of previousTutorIds) {
    if (previousId === aralTeacherId || previousId === user.id) continue;
    revalidateLearnerScoped({
      schoolId: user.schoolId,
      aralTeacherId: previousId,
      teacherShell: true,
    });
  }

  return {
    ok: true,
    data: { enrolled: toEnroll.length, redesignated: toRedesignate.length },
  };
}

const setLearnerAralTeacherSchema = z.object({
  learnerId: z.string().uuid("Invalid learner"),
  aralTeacherId: z.union([z.string().uuid("Invalid teacher"), z.literal("")]),
});

/**
 * Designate (or clear) the teacher who does weekly ARAL tracking for a learner.
 *
 * School Head only — this is the axis that lets a teacher with no advisory
 * section work on ARAL learners, so a teacher must not be able to grant it to
 * themselves. `aralTeacherId: ""` clears the designation.
 */
export async function setLearnerAralTeacher(
  formData: FormData
): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = setLearnerAralTeacherSchema.safeParse({
    learnerId: formData.get("learnerId"),
    aralTeacherId: formData.get("aralTeacherId") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const learner = await prisma.learner.findFirst({
    where: { id: parsed.data.learnerId, schoolId: user.schoolId, deletedAt: null },
    select: {
      id: true,
      schoolId: true,
      gradeLevelId: true,
      teacherId: true,
      aralTeacherId: true,
      isAralLearner: true,
    },
  });
  if (!learner) return { ok: false, error: "Not found" };

  const nextAralTeacherId =
    parsed.data.aralTeacherId === "" ? null : parsed.data.aralTeacherId;

  if (nextAralTeacherId && !learner.isAralLearner) {
    return {
      ok: false,
      error: "Enroll the learner in ARAL before assigning an ARAL teacher",
    };
  }

  if (nextAralTeacherId) {
    // Same rule the picker's list is built from. It used to accept any
    // non-deleted teacher while the list showed only active approved ones, so the
    // action quietly accepted people the School Head was never offered.
    if (!(await isEligibleAralTutor(nextAralTeacherId, user.schoolId))) {
      return { ok: false, error: "Teacher not found" };
    }
  }

  if (learner.aralTeacherId === nextAralTeacherId) return { ok: true };

  await prisma.learner.update({
    where: { id: learner.id },
    data: { aralTeacherId: nextAralTeacherId },
  });

  if (nextAralTeacherId) {
    await notifyAralAssigned({
      schoolId: user.schoolId,
      recipientId: nextAralTeacherId,
      actorId: user.id,
      learnerIds: [learner.id],
    });
  }

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.LEARNER_SET_ARAL_TEACHER,
    resource: "Learner",
    resourceId: learner.id,
    metadata: {
      schoolId: user.schoolId,
      learnerId: learner.id,
      previousAralTeacherId: learner.aralTeacherId,
      aralTeacherId: nextAralTeacherId,
    },
  });

  revalidateSchoolHeadTeachers();
  revalidatePath(SCHOOL_HEAD_ROUTES.transfer);
  revalidatePath("/teacher/aral");
  revalidatePath(`/teacher/aral/${learner.gradeLevelId}`);
  // Both the outgoing and incoming ARAL teacher's sidebar/metrics are derived
  // from the learners they track, so both have to be busted.
  revalidateLearnerScoped({
    schoolId: learner.schoolId,
    teacherId: learner.teacherId,
    aralTeacherId: learner.aralTeacherId,
    teacherShell: true,
  });
  revalidateLearnerScoped({
    schoolId: learner.schoolId,
    aralTeacherId: nextAralTeacherId,
    teacherShell: true,
  });
  return { ok: true };
}
