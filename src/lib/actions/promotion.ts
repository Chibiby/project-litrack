"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import { action } from "@/lib/errors/action";
import { AppError } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { assertSchoolYearOpen, getSchoolYearGate } from "@/lib/school-year/gate";
import { getAdvisoryPlacements, resolveAdvisoryTarget } from "@/lib/teachers/advisory";
import { getPromotionRoster, type PromotionRosterEntry } from "@/lib/learners/masterlist";
import { revalidateLearnerScoped } from "@/lib/cache/revalidate";
import { NOT_LAST_MONTH_MESSAGE } from "@/lib/learners/masterlist-grades";

/**
 * Promote / retain, in the last month of the Division Admin's active duration.
 *
 * The adviser marks each learner in one advisory section Promoted or Retained.
 * The call is stored on the learner's ACTIVE enrollment in the active year
 * (`Enrollment.outcome`); next year the enroll masterlist reads it.
 */

function failed(message: string): AppError {
  return new AppError("VALIDATION_FAILED", { params: { message } });
}

async function advisoryPlacement(user: { id: string; schoolId: string }, sectionId: string) {
  const placements = await getAdvisoryPlacements(user);
  const target = resolveAdvisoryTarget(placements, sectionId);
  if (!target.ok) throw failed(target.error);
  return target.placement;
}

/** Read: one advisory's learners with the outcome saved so far. */
export const listPromotionRoster = action(
  "listPromotionRoster",
  async (sectionId: string): Promise<{ ok: true; data: PromotionRosterEntry[] }> => {
    const user = await requireSchoolUser("TEACHER");
    const placement = await advisoryPlacement(user, sectionId);
    const gate = await getSchoolYearGate(user.schoolId);
    if (!gate.schoolYearId) return { ok: true, data: [] };
    const data = await getPromotionRoster({
      schoolId: user.schoolId,
      schoolYearId: gate.schoolYearId,
      sectionId: placement.sectionId,
    });
    return { ok: true, data };
  },
  { verb: "load the promotion list" }
);

const saveSchema = z.object({
  sectionId: z.string().min(1, "Choose an advisory section"),
  outcomes: z
    .array(
      z.object({
        learnerId: z.string().min(1),
        outcome: z.enum(["PROMOTED", "RETAINED"]),
      })
    )
    .min(1, "There are no learners to save"),
});

/** Write: save Promoted / Retained for learners in one advisory. Re-saving overwrites. */
export const savePromotionOutcomes = action(
  "savePromotionOutcomes",
  async (input: {
    sectionId: string;
    outcomes: { learnerId: string; outcome: "PROMOTED" | "RETAINED" }[];
  }): Promise<{ ok: true; promoted: number; retained: number }> => {
    const user = await requireSchoolUser("TEACHER");
    const data = parseInput(saveSchema, input);

    const gate = await assertSchoolYearOpen(user.schoolId);
    if (!gate.isLastMonth || !gate.schoolYearId) throw failed(NOT_LAST_MONTH_MESSAGE);

    const placement = await advisoryPlacement(user, data.sectionId);

    const learnerIds = [...new Set(data.outcomes.map((o) => o.learnerId))];
    const enrollments = await prisma.enrollment.findMany({
      where: {
        learnerId: { in: learnerIds },
        schoolId: user.schoolId,
        schoolYearId: gate.schoolYearId,
        sectionId: placement.sectionId,
        status: "ACTIVE",
        learner: { deletedAt: null, archivedAt: null },
      },
      select: { id: true, learnerId: true },
    });
    if (enrollments.length !== learnerIds.length) {
      throw failed("Some learners are no longer in this advisory. Refresh and try again.");
    }

    const byLearner = new Map(enrollments.map((e) => [e.learnerId, e.id]));
    const ids = (outcome: "PROMOTED" | "RETAINED") =>
      data.outcomes.filter((o) => o.outcome === outcome).map((o) => byLearner.get(o.learnerId)!);
    const promotedIds = ids("PROMOTED");
    const retainedIds = ids("RETAINED");
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      if (promotedIds.length > 0) {
        await tx.enrollment.updateMany({
          where: { id: { in: promotedIds } },
          data: { outcome: "PROMOTED", outcomeAt: now, outcomeById: user.id },
        });
      }
      if (retainedIds.length > 0) {
        await tx.enrollment.updateMany({
          where: { id: { in: retainedIds } },
          data: { outcome: "RETAINED", outcomeAt: now, outcomeById: user.id },
        });
      }
    });

    revalidatePath("/teacher/learners");
    revalidateLearnerScoped({ schoolId: user.schoolId, teacherId: user.id });
    return { ok: true, promoted: promotedIds.length, retained: retainedIds.length };
  },
  { verb: "save the promotion list" }
);
