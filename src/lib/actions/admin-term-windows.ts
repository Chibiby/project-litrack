"use server";

import { action } from "@/lib/errors/action";
import { AppError, resourceNotFound } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AUDIT_ACTIONS, writeAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { revalidateSchoolDashboard } from "@/lib/cache/revalidate";
import { adminTermWindowsSchema } from "@/lib/validators/term-window.schema";
import { formatLocalDateKey } from "@/lib/date-keys";
import { getTermWindows, TERM_PERIODS, validateTermWindows } from "@/lib/terms/windows";

export const updateAdminTermWindows = action(
  "updateAdminTermWindows",
  async (input: unknown): Promise<{ ok: true }> => {
    const user = await requireUser("SUPER_ADMIN");
    if (user.role !== "SUPER_ADMIN") {
      throw new AppError("AUTH_FORBIDDEN", { params: { what: "term window administration" }, context: { role: user.role } });
    }
    const data = parseInput(adminTermWindowsSchema, input);
    const ids = data.schoolYearIds ?? [data.schoolYearId!];
    const years = await prisma.schoolYear.findMany({
      where: { id: { in: ids }, school: { deletedAt: null } },
      select: {
        id: true, schoolId: true, startDate: true, endDate: true,
        termWindowOverrides: { select: { term: true, startKey: true, endKey: true, deadlineKey: true } },
      },
    });
    if (years.length !== ids.length) throw resourceNotFound("School year");

    const submitted = new Map(data.terms.map((term) => [term.term, term]));
    if (submitted.size !== TERM_PERIODS.length || TERM_PERIODS.some((term) => !submitted.has(term))) {
      throw new AppError("VALIDATION_FAILED", { params: { message: "All three terms are required" } });
    }

    const plans = years.map((year) => {
      const derived = getTermWindows(year.startDate);
      const effective = TERM_PERIODS.map((term) => {
        const value = submitted.get(term)!;
        return { ...value, label: derived.find((w) => w.term === term)!.label, rangeLabel: "", isOverridden: false };
      });
      const validation = validateTermWindows(effective, formatLocalDateKey(year.startDate), formatLocalDateKey(year.endDate));
      if (validation) throw new AppError("VALIDATION_FAILED", { params: { message: `${validation} (${year.id})` } });
      return { year, derived, before: getTermWindows(year.startDate, year.termWindowOverrides) };
    });

    await prisma.$transaction(async (tx) => {
      for (const { year, derived } of plans) {
        for (const term of TERM_PERIODS) {
          const next = submitted.get(term)!;
          const base = derived.find((w) => w.term === term)!;
          const isDefault = next.startKey === base.startKey && next.endKey === base.endKey && next.deadlineKey === base.deadlineKey;
          if (isDefault) {
            await tx.termWindowOverride.deleteMany({ where: { schoolYearId: year.id, term } });
          } else {
            await tx.termWindowOverride.upsert({
              where: { schoolYearId_term: { schoolYearId: year.id, term } },
              create: { schoolId: year.schoolId, schoolYearId: year.id, term, startKey: next.startKey, endKey: next.endKey, deadlineKey: next.deadlineKey, setById: user.id },
              update: { schoolId: year.schoolId, startKey: next.startKey, endKey: next.endKey, deadlineKey: next.deadlineKey, setById: user.id },
            });
          }
        }
      }
    });

    for (const { year, before } of plans) {
      await writeAudit({
        userId: user.id,
        schoolId: year.schoolId,
        action: AUDIT_ACTIONS.TERM_WINDOW_OVERRIDE_SET,
        resource: "SchoolYear",
        resourceId: year.id,
        metadata: {
          schoolYearId: year.id,
          before: before.map(({ term, startKey, endKey, deadlineKey }) => ({ term, startKey, endKey, deadlineKey })),
          after: data.terms,
          scope: data.schoolYearIds ? "ALL_SCHOOLS" : "SCHOOL",
        },
      });
      revalidateSchoolDashboard(year.schoolId);
    }
    revalidatePath("/admin/submissions");
    revalidatePath("/admin/settings/submissions");
    return { ok: true };
  },
  { verb: "save the term windows" }
);
