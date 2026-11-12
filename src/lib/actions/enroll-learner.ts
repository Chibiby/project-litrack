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
import { getMasterlist, type MasterlistEntry } from "@/lib/learners/masterlist";
import { revalidateLearnerScoped } from "@/lib/cache/revalidate";
import { BULK_TX_OPTIONS } from "@/lib/db/bulk-write";

/**
 * Enroll learner, from the masterlist of last year's promoted / retained
 * learners at the teacher's own school, into one of the teacher's advisory
 * sections in the current active school year.
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

/** Read: the masterlist for one advisory section's grade. */
export const listEnrollMasterlist = action(
  "listEnrollMasterlist",
  async (input: { sectionId: string; q?: string }): Promise<{ ok: true; data: MasterlistEntry[] }> => {
    const user = await requireSchoolUser("TEACHER");
    const placement = await advisoryPlacement(user, input.sectionId);
    const gate = await getSchoolYearGate(user.schoolId);
    if (!gate.schoolYearId) return { ok: true, data: [] };
    const data = await getMasterlist({
      schoolId: user.schoolId,
      activeSchoolYearId: gate.schoolYearId,
      targetGradeType: placement.gradeType,
      q: input.q,
    });
    return { ok: true, data };
  },
  { verb: "load the masterlist" }
);

const enrollSchema = z.object({
  sectionId: z.string().min(1, "Choose an advisory section"),
  learnerIds: z.array(z.string().min(1)).min(1, "Choose at least one learner").max(200),
});

/**
 * Write: enroll the chosen masterlist learners into one advisory section.
 *
 * In one transaction and in this order (the one-ACTIVE-enrollment
 * partial unique index needs the old row closed before the new one exists):
 * 1. complete last year's ACTIVE enrollment;
 * 2. create the ACTIVE enrollment in the active year and section;
 * 3. point the learner's grade / section / adviser at it (CLAUDE.md invariant:
 *    the Learner pointers match the active Enrollment).
 */
export const enrollFromMasterlist = action(
  "enrollFromMasterlist",
  async (input: { sectionId: string; learnerIds: string[] }): Promise<{ ok: true; enrolled: number }> => {
    const user = await requireSchoolUser("TEACHER");
    const data = parseInput(enrollSchema, input);
    const gate = await assertSchoolYearOpen(user.schoolId);
    if (!gate.schoolYearId) throw failed("There is no active school year to enroll into.");
    const schoolYearId = gate.schoolYearId;

    const placement = await advisoryPlacement(user, data.sectionId);

    const learnerIds = [...new Set(data.learnerIds)];
    const eligible = await getMasterlist({
      schoolId: user.schoolId,
      activeSchoolYearId: schoolYearId,
      targetGradeType: placement.gradeType,
      learnerIds,
    });
    if (eligible.length !== learnerIds.length) {
      throw failed(
        "Some learners can no longer be enrolled here — they may already be enrolled. Refresh and try again."
      );
    }

    const now = new Date();
    // Set-based: every chosen learner lands in the same section, so three
    // statements cover the whole batch however many learners there are.
    await prisma.$transaction(async (tx) => {
      await tx.enrollment.updateMany({
        where: { learnerId: { in: learnerIds }, status: "ACTIVE", schoolYearId: { not: schoolYearId } },
        data: { status: "COMPLETED", endedAt: now },
      });
      await tx.enrollment.createMany({
        data: learnerIds.map((learnerId) => ({
          learnerId,
          schoolId: user.schoolId,
          schoolYearId,
          gradeLevelId: placement.gradeLevelId,
          sectionId: placement.sectionId,
          teacherId: user.id,
          status: "ACTIVE" as const,
        })),
      });
      await tx.learner.updateMany({
        where: { id: { in: learnerIds }, schoolId: user.schoolId },
        data: {
          gradeLevelId: placement.gradeLevelId,
          sectionId: placement.sectionId,
          teacherId: user.id,
        },
      });
    }, BULK_TX_OPTIONS);

    revalidatePath("/teacher/learners");
    revalidateLearnerScoped({
      schoolId: user.schoolId,
      teacherId: user.id,
      teacherShell: true,
      adminDashboard: true,
    });
    return { ok: true, enrolled: learnerIds.length };
  },
  { verb: "enroll the learners" }
);
