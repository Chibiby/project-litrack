"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { GradeLevelType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  formatPersonName,
  formatOptionalPersonName,
  buildFullName,
} from "@/lib/names";
import { requireUser, requireSchoolUser } from "@/lib/auth/session";
import { schoolHeadProfileSchema } from "@/lib/validators/profile.schema";
import {
  createGradeLevelSchema,
  gradeLevelIdSchema,
  schoolStructureSchema,
  type SchoolStructureInput,
} from "@/lib/validators/grade-level.schema";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { lettersNeededToReachCount } from "@/lib/section-letters";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { deleteAuthUser } from "@/lib/auth/delete-auth-user";
import { writeAudit, writeAuditMany, AUDIT_ACTIONS } from "@/lib/audit";
import {
  releaseTeacherAdvisory,
  type ReleasedAdvisory,
} from "@/lib/teachers/release-advisory";

import {
  revalidateSchoolDashboard,
  revalidateSchoolHeadTeachers,
  revalidateSchoolsList,
  revalidateTeacherCaches,
} from "@/lib/cache/revalidate";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const teacherUserIdSchema = z.object({
  userId: z.string().uuid("Invalid teacher"),
});

const approveTeacherSchema = z.object({
  userId: z.string().uuid("Invalid teacher"),
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
    firstName: firstRaw,
    lastName: lastRaw,
    middleName: middleRaw,
    contactEmail: contactEmailRaw,
    ...profileData
  } = parsed.data;
  const firstName = formatPersonName(firstRaw);
  const lastName = formatPersonName(lastRaw);
  const middleName = formatOptionalPersonName(middleRaw) ?? null;
  const fullName = buildFullName(firstName, middleName, lastName);
  const schoolId = user.schoolId;

  // The field is optional, and the schema turns a blank one into `undefined` —
  // which Prisma reads as "leave this column alone". A head who deletes their
  // contact email and saves means to remove it, so an absent value is written as
  // an explicit null. This is the survey address (P-I4) only; the Supabase login
  // identity on `User.email` is never touched here.
  const contactEmail = contactEmailRaw ?? null;

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
      create: { userId: user.id, ...profileData, contactEmail },
      update: { ...profileData, contactEmail },
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

  // One batched insert for every row the bootstrap created. Both loops wrote
  // one row per created id, so deferring them individually would fan out into
  // (grades + sections) concurrent inserts after the response; batching keeps it
  // at a single statement.
  await writeAuditMany([
    ...bootstrap.createdGradeIds.map((gradeId) => ({
      userId: user.id,
      schoolId,
      action: AUDIT_ACTIONS.GRADE_LEVEL_CREATE,
      resource: "GradeLevel",
      resourceId: gradeId,
      metadata: { schoolId, gradeLevelId: gradeId, source: "profiling_bootstrap" },
    })),
    ...bootstrap.createdSectionIds.map((sectionId) => ({
      userId: user.id,
      schoolId,
      action: AUDIT_ACTIONS.SECTION_CREATE,
      resource: "Section",
      resourceId: sectionId,
      metadata: { schoolId, sectionId, source: "profiling_bootstrap" },
    })),
  ]);

  revalidatePath(SCHOOL_HEAD_ROUTES.settingsProfile);
  revalidatePath(SCHOOL_HEAD_ROUTES.schoolGradeLevels);
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

  revalidatePath(SCHOOL_HEAD_ROUTES.schoolGradeLevels);
  revalidateSchoolDashboard(user.schoolId);
  // Login "teachers open" depends on at least one grade level.
  revalidateSchoolsList();
}

/**
 * Deactivate a grade that was set up by mistake.
 *
 * REFUSES WHILE ANY LEARNER REMAINS, reporting the count so the head moves them
 * first. That refusal is the point of the whole feature: deactivating is for a
 * mistake, and a mistake has nobody in it. Hiding a class of real learners
 * behind a toggle — they would vanish from every roster, dashboard and report at
 * once, with no record of where they went — is the failure this rule exists to
 * prevent, and it is why `GRADE_LEVEL_ARCHIVE` can never mark such a moment.
 *
 * "Remains" means `deletedAt: null`, which includes ARCHIVED learners. An
 * archived learner can be brought back, and bringing one back into a deactivated
 * grade would put them somewhere nobody can see. Only a soft-deleted learner is
 * gone in the sense that matters here.
 *
 * The grade's live sections go with it, stamped with the SAME `deletedAt` — that
 * shared timestamp is what `restoreGradeLevel` reads to tell "archived with this
 * grade" from "archived earlier, on purpose". A section a head deleted last term
 * must not come back because the grade around it did.
 *
 * Advisers of those sections are freed, exactly as `deleteSection` frees them:
 * the section is only soft-deleted, so the FK stays valid and the teacher would
 * otherwise hold an advisory slot on a section nobody can see. That is
 * deliberate and one-way — restore does not re-attach them.
 */
export async function archiveGradeLevel(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = gradeLevelIdSchema.safeParse({
    // Coerced, not passed raw: a missing field is `null`, and Zod would answer
    // "Expected string, received null" where the head needs "Grade level
    // required". Same shape as `createNextLetterSection`.
    gradeLevelId: String(formData.get("gradeLevelId") ?? ""),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const grade = await prisma.gradeLevel.findFirst({
    where: { id: parsed.data.gradeLevelId, schoolId: user.schoolId, deletedAt: null },
    select: { id: true, type: true },
  });
  if (!grade) return { ok: false, error: "Grade level not found" };

  const learnerCount = await prisma.learner.count({
    where: { gradeLevelId: grade.id, schoolId: user.schoolId, deletedAt: null },
  });
  if (learnerCount > 0) {
    const label = GRADE_LEVEL_LABELS[grade.type] ?? grade.type;
    return {
      ok: false,
      error:
        `${label} still holds ${learnerCount} ${learnerCount === 1 ? "learner" : "learners"}. ` +
        "Move or transfer them to another grade first.",
    };
  }

  try {
    const affectedTeacherIds = await prisma.$transaction(async (tx) => {
      // One timestamp for the grade and every section going down with it. Two
      // `new Date()` calls would differ by milliseconds and break the pairing
      // restore depends on.
      const archivedAt = new Date();

      const sections = await tx.section.findMany({
        where: { gradeLevelId: grade.id, deletedAt: null },
        select: { id: true },
      });
      const sectionIds = sections.map((s) => s.id);

      await tx.gradeLevel.update({
        where: { id: grade.id },
        data: { deletedAt: archivedAt },
      });

      if (sectionIds.length > 0) {
        await tx.section.updateMany({
          where: { id: { in: sectionIds } },
          data: { deletedAt: archivedAt },
        });
      }

      // Read the advisers before nulling the pointer — afterwards there is no
      // way back to who they were, and their caches have to be busted below.
      const advisers = sectionIds.length
        ? await tx.user.findMany({
            where: { advisorySectionId: { in: sectionIds } },
            select: { id: true },
          })
        : [];
      if (sectionIds.length > 0) {
        await tx.user.updateMany({
          where: { advisorySectionId: { in: sectionIds } },
          data: { advisorySectionId: null },
        });
      }

      const assigned = sectionIds.length
        ? await tx.teacherSection.findMany({
            where: { sectionId: { in: sectionIds } },
            select: { teacherId: true },
          })
        : [];
      if (sectionIds.length > 0) {
        await tx.teacherSection.deleteMany({ where: { sectionId: { in: sectionIds } } });
      }

      // The legacy `taughtGrades` mirror. Nothing reads it for access any more
      // (see `teacherGradeScope`), but leaving a link to a deactivated grade
      // would make it disagree with the grade itself.
      const linked = await tx.user.findMany({
        where: { taughtGrades: { some: { id: grade.id } } },
        select: { id: true },
      });
      for (const t of linked) {
        await tx.user.update({
          where: { id: t.id },
          data: { taughtGrades: { disconnect: { id: grade.id } } },
        });
      }

      return [
        ...new Set([
          ...advisers.map((a) => a.id),
          ...assigned.map((a) => a.teacherId),
          ...linked.map((t) => t.id),
        ]),
      ];
    });

    await writeAudit({
      userId: user.id,
      schoolId: user.schoolId,
      action: AUDIT_ACTIONS.GRADE_LEVEL_ARCHIVE,
      resource: "GradeLevel",
      resourceId: grade.id,
      metadata: {
        schoolId: user.schoolId,
        gradeLevelId: grade.id,
        type: grade.type,
        freedTeachers: affectedTeacherIds.length,
      },
    });

    revalidatePath(SCHOOL_HEAD_ROUTES.schoolGradeLevels);
    revalidateSchoolHeadTeachers(user.schoolId);
    revalidateSchoolDashboard(user.schoolId);
    // Login "teachers open" depends on at least one grade level, same as create.
    revalidateSchoolsList();
    for (const teacherId of affectedTeacherIds) {
      revalidateTeacherCaches(teacherId);
    }
    return { ok: true };
  } catch (err) {
    console.error("[archiveGradeLevel]", err);
    return { ok: false, error: "Failed to deactivate grade level" };
  }
}

/**
 * Bring back a deactivated grade, and with it the sections deactivated in the
 * same act — mirroring what `bootstrapSchoolStructure` already does when it
 * revives a soft-deleted grade.
 *
 * "In the same act" is the grade's own `deletedAt`, matched exactly. A section
 * the head deleted separately carries a different timestamp and stays deleted,
 * so restoring a grade cannot quietly undo an unrelated decision.
 *
 * Advisers are not restored. Archiving freed them and they may hold another
 * section by now; `Section.adviserId` is unique, so re-attaching could collide
 * with a live assignment. A head reassigns from the teachers table.
 */
export async function restoreGradeLevel(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = gradeLevelIdSchema.safeParse({
    // Coerced, not passed raw: a missing field is `null`, and Zod would answer
    // "Expected string, received null" where the head needs "Grade level
    // required". Same shape as `createNextLetterSection`.
    gradeLevelId: String(formData.get("gradeLevelId") ?? ""),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const grade = await prisma.gradeLevel.findFirst({
    where: {
      id: parsed.data.gradeLevelId,
      schoolId: user.schoolId,
      deletedAt: { not: null },
    },
    select: { id: true, type: true, deletedAt: true },
  });
  if (!grade?.deletedAt) return { ok: false, error: "Grade level not found" };

  try {
    const restoredSections = await prisma.$transaction(async (tx) => {
      const { count } = await tx.section.updateMany({
        where: { gradeLevelId: grade.id, deletedAt: grade.deletedAt },
        data: { deletedAt: null },
      });
      await tx.gradeLevel.update({
        where: { id: grade.id },
        data: { deletedAt: null },
      });
      return count;
    });

    await writeAudit({
      userId: user.id,
      schoolId: user.schoolId,
      action: AUDIT_ACTIONS.GRADE_LEVEL_RESTORE,
      resource: "GradeLevel",
      resourceId: grade.id,
      metadata: {
        schoolId: user.schoolId,
        gradeLevelId: grade.id,
        type: grade.type,
        restoredSections,
      },
    });

    revalidatePath(SCHOOL_HEAD_ROUTES.schoolGradeLevels);
    revalidateSchoolDashboard(user.schoolId);
    revalidateSchoolsList();
    return { ok: true };
  } catch (err) {
    console.error("[restoreGradeLevel]", err);
    return { ok: false, error: "Failed to restore grade level" };
  }
}

/**
 * Approve a pending teacher self-registration.
 *
 * No advisory section is assigned here: a teacher self-assigns their
 * grade+section (or opts to stay ARAL-only) via the profiling wizard
 * (`saveTeacherProfile`), which is now the sole writer of
 * `User.advisorySectionId`.
 */
export async function approveTeacher(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = approveTeacherSchema.safeParse({ userId: formData.get("userId") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const { userId } = parsed.data;

  const teacher = await prisma.user.findFirst({
    where: {
      id: userId,
      schoolId: user.schoolId,
      role: "TEACHER",
      approvalStatus: "PENDING",
      deletedAt: null,
    },
  });

  if (!teacher) return { ok: false, error: "Pending teacher not found" };

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
    },
  });

  revalidateSchoolHeadTeachers(user.schoolId);
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

  revalidateSchoolHeadTeachers(user.schoolId);
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

  revalidateSchoolHeadTeachers(user.schoolId);
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

  revalidateSchoolHeadTeachers(user.schoolId);
  revalidateSchoolDashboard(user.schoolId);
  revalidateTeacherCaches(teacher.id);
  return { ok: true };
}

/**
 * Soft-remove an approved teacher: blocks sign-in, frees the email for re-register,
 * and keeps historical records (attendance, grades, closed enrolments) intact.
 *
 * Their advisory is released in the same transaction: every section they
 * advised goes back to Unassigned and their advisory learners are left with no
 * adviser until the School Head gives the section a new one, who picks them up
 * (see `releaseTeacherAdvisory` and `setTeacherAdvisory`'s `add`).
 *
 * Still refuses while they are someone's designated ARAL teacher — that is a
 * separate assignment the School Head must hand over deliberately.
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
    select: {
      id: true,
      authId: true,
      email: true,
      _count: { select: { aralLearners: { where: { deletedAt: null } } } },
    },
  });
  if (!teacher) return { ok: false, error: "Teacher not found" };

  // Advisory learners no longer block removal — they are released below. ARAL
  // designations still do: nothing releases those, so a removed teacher would
  // stay the named tutor of learners nobody is then tracking. The School Head
  // designates someone else first.
  if (teacher._count.aralLearners > 0) {
    return {
      ok: false,
      error: `Reassign ${teacher._count.aralLearners} ARAL learner(s) to another teacher before removing this teacher.`,
    };
  }

  const authDelete = await deleteAuthUser(teacher.authId);
  if (!authDelete.ok) {
    console.error("[removeTeacher] auth delete failed:", authDelete.error);
    return { ok: false, error: authDelete.error };
  }

  // Read back by `originalTeacherEmail` on the Removed tab — keep the two in step.
  const freedEmail = `${teacher.email}.deleted.${Date.now()}`;
  let released: ReleasedAdvisory;
  try {
    released = await prisma.$transaction(async (tx) => {
      // Sections, learners and the legacy advisory mirrors, all at once. A
      // soft-deleted teacher left naming a section would keep it out of every
      // School Head's reach — no FK action fires on a soft delete.
      const result = await releaseTeacherAdvisory(tx, {
        teacherId: teacher.id,
        schoolId: user.schoolId,
      });
      await tx.user.update({
        where: { id: teacher.id },
        data: {
          email: freedEmail,
          isActive: false,
          deletedAt: new Date(),
        },
      });
      return result;
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
    metadata: {
      schoolId: user.schoolId,
      teacherId: teacher.id,
      // What the removal handed back, so the log answers "which class lost its
      // adviser, and when" without a join against rows that have since moved.
      releasedSectionIds: released.sectionIds,
      learnersUnassigned: released.learnerCount,
    },
  });

  revalidateSchoolHeadTeachers(user.schoolId);
  revalidatePath(SCHOOL_HEAD_ROUTES.schoolGradeLevels);
  revalidateSchoolDashboard(user.schoolId);
  revalidateTeacherCaches(teacher.id);
  return { ok: true };
}
