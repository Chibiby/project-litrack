"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import {
  createDivisionSchoolYearSchema,
  deleteSchoolYearSchema,
  setActiveSchoolYearSchema,
  setDivisionDurationSchema,
  setSchoolYearMonthsSchema,
} from "@/lib/validators/school-year.schema";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import {
  revalidateAdminDashboard,
  revalidateAllCachedData,
  revalidateSchoolDashboard,
} from "@/lib/cache/revalidate";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { ADMIN_ROUTES } from "@/lib/routes/admin";
import { action } from "@/lib/errors/action";
import { AppError, fieldError, resourceNotFound } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { isActiveYearConflict } from "@/lib/school-year-conflicts";
import { monthEnd, monthStart, toMonthKey } from "@/lib/school-year/months";

/*
 * Who does what (owner decision 2026-11-12):
 * - Division Admin (any Super Admin) creates a school year for every school at
 *   once, chooses which year is active, and removes an empty year.
 * - School Head sets only the start month and, optionally, the end month of
 *   their own school's years. Everything else on the page is read-only to them.
 * - District Admin has no school-year page at all.
 */

type ActionResult = { ok: true } | { ok: false; error: string };
type CreateResult =
  | { ok: true; created: number; skipped: number }
  | { ok: false; error: string };

function activeYearRaced(): AppError {
  return new AppError("VALIDATION_FAILED", {
    params: { message: "Another school year was just made active. Refresh and try again." },
  });
}

function revalidateYearPages(schoolId: string) {
  revalidatePath(SCHOOL_HEAD_ROUTES.schoolYears);
  revalidatePath(ADMIN_ROUTES.schoolYears);
  revalidateSchoolDashboard(schoolId);
  revalidateAdminDashboard();
}

/**
 * Create one school year, by label, for every live school that does not have it
 * yet. With `setActive`, it also becomes each of those schools' active year.
 */
export const createDivisionSchoolYear = action(
  "createDivisionSchoolYear",
  async (formData: FormData): Promise<CreateResult> => {
    const user = await requireUser("SUPER_ADMIN");

    const data = parseInput(createDivisionSchoolYearSchema, {
      label: formData.get("label"),
      startMonth: formData.get("startMonth"),
      endMonth: formData.get("endMonth"),
      setActive: formData.get("setActive") ?? false,
    });
    const startDate = monthStart(data.startMonth)!;
    const endDate = data.endMonth ? monthEnd(data.endMonth)! : null;

    const [schools, totalSchools] = await Promise.all([
      prisma.school.findMany({
        where: { deletedAt: null, schoolYears: { none: { label: data.label } } },
        select: { id: true },
      }),
      prisma.school.count({ where: { deletedAt: null } }),
    ]);
    if (schools.length === 0) {
      throw fieldError("label", "Every school already has this school year");
    }
    const schoolIds = schools.map((s) => s.id);

    try {
      await prisma.$transaction(async (tx) => {
        if (data.setActive) {
          await tx.schoolYear.updateMany({
            where: { schoolId: { in: schoolIds }, isActive: true },
            data: { isActive: false },
          });
        }
        await tx.schoolYear.createMany({
          data: schoolIds.map((schoolId) => ({
            schoolId,
            label: data.label,
            startDate,
            endDate,
            isActive: data.setActive,
          })),
          skipDuplicates: true,
        });
      });
    } catch (err) {
      if (isActiveYearConflict(err)) throw activeYearRaced();
      throw err;
    }

    await writeAudit({
      userId: user.id,
      schoolId: null,
      action: AUDIT_ACTIONS.SCHOOL_YEAR_CREATE,
      resource: "SchoolYear",
      resourceId: data.label,
      metadata: { label: data.label, schools: schoolIds.length, isActive: data.setActive },
    });

    revalidatePath(SCHOOL_HEAD_ROUTES.schoolYears);
    revalidatePath(ADMIN_ROUTES.schoolYears);
    revalidateAllCachedData();
    return { ok: true, created: schoolIds.length, skipped: totalSchools - schoolIds.length };
  },
  { verb: "create the school year" }
);

/**
 * Division Admin: set the active duration of one school-year label for the
 * whole division, and make that label the active year at every school.
 *
 * Inside the duration, schools can enroll and edit; outside it everything is
 * read-only (`assertSchoolYearOpen`). A school that does not have the label
 * yet gets it, with the duration's months as its class months, so every
 * school has a year to enroll against. Learners keep their enrollment in the
 * year they were in; moving them up is the enroll-from-masterlist flow.
 */
export const setDivisionActiveDuration = action(
  "setDivisionActiveDuration",
  async (formData: FormData): Promise<CreateResult> => {
    const user = await requireUser("SUPER_ADMIN");
    const data = parseInput(setDivisionDurationSchema, {
      label: formData.get("label"),
      startMonth: formData.get("startMonth"),
      endMonth: formData.get("endMonth"),
    });
    const activeStart = monthStart(data.startMonth)!;
    const activeEnd = monthEnd(data.endMonth)!;

    const missing = await prisma.school.findMany({
      where: { deletedAt: null, schoolYears: { none: { label: data.label } } },
      select: { id: true },
    });

    try {
      await prisma.$transaction(async (tx) => {
        await tx.divisionSchoolYear.upsert({
          where: { label: data.label },
          create: { label: data.label, activeStart, activeEnd, updatedById: user.id },
          update: { activeStart, activeEnd, updatedById: user.id },
        });
        if (missing.length > 0) {
          await tx.schoolYear.createMany({
            data: missing.map((s) => ({
              schoolId: s.id,
              label: data.label,
              startDate: activeStart,
              endDate: activeEnd,
              isActive: false,
            })),
            skipDuplicates: true,
          });
        }
        // Switch every live school to this label: other years off first, so the
        // one-active-year partial unique index never sees two.
        await tx.schoolYear.updateMany({
          where: { isActive: true, label: { not: data.label }, school: { deletedAt: null } },
          data: { isActive: false },
        });
        await tx.schoolYear.updateMany({
          where: { label: data.label, isActive: false, school: { deletedAt: null } },
          data: { isActive: true },
        });
      });
    } catch (err) {
      if (isActiveYearConflict(err)) throw activeYearRaced();
      throw err;
    }

    await writeAudit({
      userId: user.id,
      schoolId: null,
      action: AUDIT_ACTIONS.SCHOOL_YEAR_SET_ACTIVE,
      resource: "DivisionSchoolYear",
      resourceId: data.label,
      metadata: { label: data.label, start: data.startMonth, end: data.endMonth, created: missing.length },
    });

    revalidatePath(SCHOOL_HEAD_ROUTES.schoolYears);
    revalidatePath(ADMIN_ROUTES.schoolYears);
    revalidateAllCachedData();
    return { ok: true, created: missing.length, skipped: 0 };
  },
  { verb: "set the active school year" }
);

/** Division Admin: make one school's year its active year. */
export const setActiveSchoolYear = action(
  "setActiveSchoolYear",
  async (formData: FormData): Promise<ActionResult> => {
    const user = await requireUser("SUPER_ADMIN");
    const data = parseInput(setActiveSchoolYearSchema, {
      schoolYearId: formData.get("schoolYearId"),
    });

    const year = await prisma.schoolYear.findFirst({
      where: { id: data.schoolYearId, school: { deletedAt: null } },
      select: { id: true, schoolId: true, label: true },
    });
    if (!year) throw resourceNotFound("School year");

    try {
      await prisma.$transaction(async (tx) => {
        await tx.schoolYear.updateMany({
          where: { schoolId: year.schoolId, isActive: true },
          data: { isActive: false },
        });
        await tx.schoolYear.update({ where: { id: year.id }, data: { isActive: true } });
      });
    } catch (err) {
      if (isActiveYearConflict(err)) throw activeYearRaced();
      throw err;
    }

    await writeAudit({
      userId: user.id,
      schoolId: year.schoolId,
      action: AUDIT_ACTIONS.SCHOOL_YEAR_SET_ACTIVE,
      resource: "SchoolYear",
      resourceId: year.id,
      metadata: { schoolId: year.schoolId, label: year.label },
    });

    revalidateYearPages(year.schoolId);
    return { ok: true };
  },
  { verb: "set the active school year" }
);

/**
 * School Head (or a Division Admin viewing the school): set the start month and,
 * when known, the end month. A blank end month is stored as "not set"; reports
 * and term windows then assume the year runs ten months (`effectiveYearEnd`).
 *
 * Enrollment rows point at the year by id and are never moved, so changing the
 * months only changes the range reports and term windows use.
 */
export const setSchoolYearMonths = action(
  "setSchoolYearMonths",
  async (formData: FormData): Promise<ActionResult> => {
    const user = await requireUser(["SCHOOL_HEAD", "SUPER_ADMIN"]);

    const data = parseInput(setSchoolYearMonthsSchema, {
      schoolYearId: formData.get("schoolYearId"),
      startMonth: formData.get("startMonth"),
      endMonth: formData.get("endMonth"),
    });

    const isAdmin = user.role === "SUPER_ADMIN";
    // A School Head is scoped to their own school, so a guessed id from another
    // tenant reads as "not found" rather than confirming the row exists.
    if (!isAdmin && !user.schoolId) throw resourceNotFound("School year");
    const year = await prisma.schoolYear.findFirst({
      where: {
        id: data.schoolYearId,
        school: { deletedAt: null },
        ...(isAdmin ? {} : { schoolId: user.schoolId! }),
      },
      select: { id: true, schoolId: true, startDate: true, endDate: true },
    });
    if (!year) throw resourceNotFound("School year");

    const startDate = monthStart(data.startMonth)!;
    const endDate = data.endMonth ? monthEnd(data.endMonth)! : null;
    await prisma.schoolYear.update({ where: { id: year.id }, data: { startDate, endDate } });

    await writeAudit({
      userId: user.id,
      schoolId: year.schoolId,
      action: AUDIT_ACTIONS.SCHOOL_YEAR_UPDATE,
      resource: "SchoolYear",
      resourceId: year.id,
      metadata: {
        schoolId: year.schoolId,
        from: {
          start: toMonthKey(year.startDate),
          end: year.endDate ? toMonthKey(year.endDate) : null,
        },
        to: { start: data.startMonth, end: data.endMonth },
      },
    });

    revalidateYearPages(year.schoolId);
    return { ok: true };
  },
  { verb: "save the school year months" }
);

/**
 * Division Admin: remove a school year that has no records against it — the
 * duplicate-year mistake. `SchoolYear` has no `deletedAt`, so this is a real row
 * delete; anything with history, or the active year, is refused.
 */
export const deleteSchoolYear = action(
  "deleteSchoolYear",
  async (formData: FormData): Promise<ActionResult> => {
    const user = await requireUser("SUPER_ADMIN");
    const data = parseInput(deleteSchoolYearSchema, {
      schoolYearId: formData.get("schoolYearId"),
    });

    const year = await prisma.schoolYear.findFirst({
      where: { id: data.schoolYearId },
      select: {
        id: true,
        schoolId: true,
        label: true,
        isActive: true,
        _count: { select: { enrollments: true, termGrades: true } },
      },
    });
    if (!year) throw resourceNotFound("School year");

    if (year.isActive) {
      return { ok: false, error: "Set another year active before deleting this one" };
    }
    if (year._count.enrollments > 0 || year._count.termGrades > 0) {
      return {
        ok: false,
        error: "This year has enrolments or grades recorded against it and cannot be deleted",
      };
    }

    // Re-checks emptiness inside the delete so a concurrent enrolment cannot
    // slip in between the read above and the write.
    const res = await prisma.schoolYear.deleteMany({
      where: {
        id: year.id,
        isActive: false,
        enrollments: { none: {} },
        termGrades: { none: {} },
      },
    });
    if (res.count === 0) {
      return { ok: false, error: "This year is no longer empty and cannot be deleted" };
    }

    await writeAudit({
      userId: user.id,
      schoolId: year.schoolId,
      action: AUDIT_ACTIONS.SCHOOL_YEAR_DELETE,
      resource: "SchoolYear",
      resourceId: year.id,
      metadata: { schoolId: year.schoolId, label: year.label },
    });

    revalidateYearPages(year.schoolId);
    return { ok: true };
  },
  { verb: "delete the school year" }
);
