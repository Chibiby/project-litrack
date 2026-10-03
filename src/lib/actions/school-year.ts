"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import {
  createSchoolYearSchema,
  deleteSchoolYearSchema,
  setActiveSchoolYearSchema,
  updateSchoolYearSchema,
} from "@/lib/validators/school-year.schema";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { revalidateSchoolDashboard } from "@/lib/cache/revalidate";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { action } from "@/lib/errors/action";
import { AppError, fieldError, resourceNotFound } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { isActiveYearConflict, isLabelConflict } from "@/lib/school-year-conflicts";

type ActionResult = { ok: true } | { ok: false; error: string };

function activeYearRaced(): AppError {
  return new AppError("VALIDATION_FAILED", {
    params: { message: "Another school year was just made active. Refresh and try again." },
  });
}

export const createSchoolYear = action("createSchoolYear", async (formData: FormData): Promise<ActionResult> => {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = {
    data: parseInput(createSchoolYearSchema, {
      label: formData.get("label"),
      startDate: formData.get("startDate"),
      endDate: formData.get("endDate"),
      setActive: formData.get("setActive") ?? false,
    }),
  };

  const startDate = new Date(parsed.data.startDate);
  const endDate = new Date(parsed.data.endDate);

  let year;
  try {
    year = await prisma.$transaction(async (tx) => {
      if (parsed.data.setActive) {
        await tx.schoolYear.updateMany({
          where: { schoolId: user.schoolId, isActive: true },
          data: { isActive: false },
        });
      }

      return tx.schoolYear.create({
        data: {
          schoolId: user.schoolId,
          label: parsed.data.label,
          startDate,
          endDate,
          isActive: parsed.data.setActive,
        },
      });
    });
  } catch (err) {
    if (isActiveYearConflict(err)) throw activeYearRaced();
    if (isLabelConflict(err)) {
      throw fieldError("label", "A school year with this label already exists");
    }
    throw err;
  }

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.SCHOOL_YEAR_CREATE,
    resource: "SchoolYear",
    resourceId: year.id,
    metadata: {
      schoolId: user.schoolId,
      label: year.label,
      isActive: year.isActive,
    },
  });

  revalidatePath(SCHOOL_HEAD_ROUTES.schoolYears);
  revalidateSchoolDashboard(user.schoolId);
  return { ok: true };
}, { verb: "create the school year" });

export const setActiveSchoolYear = action("setActiveSchoolYear", async (formData: FormData): Promise<ActionResult> => {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = {
    data: parseInput(setActiveSchoolYearSchema, {
      schoolYearId: formData.get("schoolYearId"),
    }),
  };

  const year = await prisma.schoolYear.findFirst({
    where: { id: parsed.data.schoolYearId, schoolId: user.schoolId },
  });
  if (!year) throw resourceNotFound("School year");

  try {
    await prisma.$transaction(async (tx) => {
      await tx.schoolYear.updateMany({
        where: { schoolId: user.schoolId, isActive: true },
        data: { isActive: false },
      });
      await tx.schoolYear.update({
        where: { id: year.id },
        data: { isActive: true },
      });
    });
  } catch (err) {
    if (isActiveYearConflict(err)) throw activeYearRaced();
    throw err;
  }

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.SCHOOL_YEAR_SET_ACTIVE,
    resource: "SchoolYear",
    resourceId: year.id,
    metadata: { schoolId: user.schoolId, label: year.label },
  });

  revalidatePath(SCHOOL_HEAD_ROUTES.schoolYears);
  revalidateSchoolDashboard(user.schoolId);
  return { ok: true };
}, { verb: "set the active school year" });

/**
 * Correct a school year's label or date range.
 *
 * A head who mistypes `2024-2025` for `2025-2026`, or picks June 2 when the
 * division said June 9, previously had no way back — the row was write-once, so
 * the wrong label followed every report for a year. This is that way back.
 *
 * Dates stay editable even once learners are enrolled. That is a deliberate
 * call: the alternative locks a typo in permanently the moment the first learner
 * lands, which is within minutes of creating the year. Enrollment rows point at
 * this year by id and are *not* moved or re-dated, so widening the range never
 * changes who is enrolled — it only corrects the range reports display. The
 * dialog says so in as many words when the year has records.
 *
 * `isActive` is not editable here on purpose: activation has its own action and
 * its own audit row, so fixing a typo can never quietly change which year
 * learners enrol against.
 */
export const updateSchoolYear = action("updateSchoolYear", async (formData: FormData): Promise<ActionResult> => {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = {
    data: parseInput(updateSchoolYearSchema, {
      schoolYearId: formData.get("schoolYearId"),
      label: formData.get("label"),
      startDate: formData.get("startDate"),
      endDate: formData.get("endDate"),
    }),
  };

  // Scoped to the caller's school, so a guessed id from another tenant reads as
  // "not found" rather than confirming the row exists.
  const year = await prisma.schoolYear.findFirst({
    where: { id: parsed.data.schoolYearId, schoolId: user.schoolId },
  });
  if (!year) throw resourceNotFound("School year");

  const startDate = new Date(parsed.data.startDate);
  const endDate = new Date(parsed.data.endDate);

  let updated;
  try {
    updated = await prisma.schoolYear.update({
      where: { id: year.id },
      data: { label: parsed.data.label, startDate, endDate },
    });
  } catch (err) {
    if (isLabelConflict(err)) {
      throw fieldError("label", "Another school year already uses this label");
    }
    throw err;
  }

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.SCHOOL_YEAR_UPDATE,
    resource: "SchoolYear",
    resourceId: year.id,
    metadata: {
      schoolId: user.schoolId,
      from: {
        label: year.label,
        startDate: year.startDate.toISOString().slice(0, 10),
        endDate: year.endDate.toISOString().slice(0, 10),
      },
      to: {
        label: updated.label,
        startDate: updated.startDate.toISOString().slice(0, 10),
        endDate: updated.endDate.toISOString().slice(0, 10),
      },
    },
  });

  revalidatePath(SCHOOL_HEAD_ROUTES.schoolYears);
  revalidateSchoolDashboard(user.schoolId);
  return { ok: true };
}, { verb: "update the school year" });

/**
 * Remove a school year that has no records against it.
 *
 * Scoped this narrowly because `SchoolYear` is the spine of the longitudinal
 * record and has no `deletedAt` column — a delete here is a real row delete.
 * The mistake actually worth undoing is the duplicate: a head creates
 * `2026-2027`, does not see it in the list, and creates it again. Once a single
 * enrollment or term grade points at the year, removing it would orphan history,
 * so the action refuses and says which records are in the way.
 *
 * The active year is also protected: dropping it would leave the school with no
 * year to enrol against, and the head almost certainly means to activate a
 * different one instead.
 */
export const deleteSchoolYear = action("deleteSchoolYear", async (formData: FormData): Promise<ActionResult> => {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = {
    data: parseInput(deleteSchoolYearSchema, {
      schoolYearId: formData.get("schoolYearId"),
    }),
  };

  const year = await prisma.schoolYear.findFirst({
    where: { id: parsed.data.schoolYearId, schoolId: user.schoolId },
    select: {
      id: true,
      label: true,
      isActive: true,
      _count: { select: { enrollments: true, termGrades: true } },
    },
  });
  if (!year) throw resourceNotFound("School year");

  if (year.isActive) {
    return {
      ok: false,
      error: "Set another year active before deleting this one",
    };
  }
  if (year._count.enrollments > 0 || year._count.termGrades > 0) {
    return {
      ok: false,
      error:
        "This year has enrolments or grades recorded against it and cannot be deleted",
    };
  }

  // Re-checks emptiness inside the delete so a concurrent enrolment cannot slip
  // in between the read above and the write.
  const res = await prisma.schoolYear.deleteMany({
    where: {
      id: year.id,
      schoolId: user.schoolId,
      isActive: false,
      enrollments: { none: {} },
      termGrades: { none: {} },
    },
  });
  if (res.count === 0) {
    return {
      ok: false,
      error: "This year is no longer empty and cannot be deleted",
    };
  }

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.SCHOOL_YEAR_DELETE,
    resource: "SchoolYear",
    resourceId: year.id,
    metadata: { schoolId: user.schoolId, label: year.label },
  });

  revalidatePath(SCHOOL_HEAD_ROUTES.schoolYears);
  revalidateSchoolDashboard(user.schoolId);
  return { ok: true };
}, { verb: "delete the school year" });