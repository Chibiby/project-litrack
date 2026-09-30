"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import { assertSameSchool } from "@/lib/auth/tenant";
import { aralMosyDecisionSchema } from "@/lib/validators/aral-mosy.schema";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { revalidateLearnerScoped } from "@/lib/cache/revalidate";
import { action } from "@/lib/errors/action";
import { AppError, fieldError, resourceNotFound } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { resolveMosySave, type MosySaveFailure, type MosyTransition } from "@/lib/aral/mosy";
import { formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";
import { loadPreviousFilipinoLevel } from "@/lib/aral/mosy-queries";
import { ARAL_MOSY_HREF, ARAL_PROFILING_HREF } from "@/lib/nav/nav-config";

function formToObj(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) obj[k] = v;
  return obj;
}

const FAILURE_FIELD: Record<
  Exclude<MosySaveFailure, "OUT_OF_SCOPE">,
  { field: string; message: string }
> = {
  LEVEL_NOT_ALLOWED: {
    field: "mosyLevel",
    message: "That reading level is not used for this learner's grade",
  },
  REASON_REQUIRED: {
    field: "reason",
    message: "Choose a reason for moving the learner out",
  },
  REASON_NOT_ALLOWED: {
    field: "reason",
    message: "That reason is not available for this learner's grade",
  },
  DECISION_REQUIRED: {
    field: "decision",
    message: "Choose whether the learner moves out or stays in ARAL",
  },
};

/**
 * Authorization: `requireSchoolUser("TEACHER")`. Tenancy: `schoolId` on the row
 * comes from the session, `assertSameSchool` on the DB-loaded learner, then
 * `resolveMosySave` enforces tutor scope (`teacherOwnsMosyRow`) — the designated
 * tutor of a tagged learner, or whoever recorded the Move out. Anything else,
 * Super Admin included, is NOT_FOUND. The decision row and any learner untag /
 * re-tag commit in one transaction.
 */
export const saveMosyDecision = action(
  "saveMosyDecision",
  async (
    formData: FormData
  ): Promise<{ ok: true; data: { transition: MosyTransition } }> => {
    const user = await requireSchoolUser("TEACHER");
    const input = parseInput(aralMosyDecisionSchema, formToObj(formData));

    const result = await prisma.$transaction(async (tx) => {
      // Serialise concurrent saves for one learner (READ COMMITTED takes no lock):
      // the second waits here, then reads the first's committed untag / re-tag, so
      // it cannot resolve a stale STAY against an already-untagged learner. Scoped
      // to the session's school; a foreign learner locks nothing and falls through
      // to the NOT_FOUND path below.
      await tx.$queryRaw`SELECT "id" FROM "Learner" WHERE "id" = ${input.learnerId} AND "schoolId" = ${user.schoolId} FOR UPDATE`;

      // Fresh read, not the cached getActiveSchoolYear: a write must not trust a TTL.
      const schoolYear = await tx.schoolYear.findFirst({
        where: { schoolId: user.schoolId, isActive: true },
        select: { id: true, startDate: true },
      });
      if (!schoolYear) throw new AppError("SCHOOL_YEAR_NOT_ACTIVE");

      const learner = await tx.learner.findFirst({
        where: { id: input.learnerId, deletedAt: null, archivedAt: null },
        select: {
          schoolId: true,
          teacherId: true,
          gradeLevelId: true,
          isAralLearner: true,
          aralTeacherId: true,
          aralEnrolledAt: true,
          gradeLevel: { select: { type: true } },
        },
      });
      if (!learner) throw resourceNotFound("Learner");
      assertSameSchool(user.schoolId, learner.schoolId, "Learner");

      const existing = await tx.aralMosyDecision.findUnique({
        where: {
          learnerId_schoolYearId: { learnerId: input.learnerId, schoolYearId: schoolYear.id },
        },
        select: { decision: true, tutorId: true, priorAralEnrolledAt: true },
      });

      // Same lookup the page uses for "previous level" (learner already verified
      // to belong to the session's school above).
      const previousFilipinoLevel = await loadPreviousFilipinoLevel(
        tx,
        input.learnerId,
        // Same normalisation the page applies to its startDateKey.
        parseLocalDateKey(formatLocalDateKey(schoolYear.startDate))
      );

      const resolved = resolveMosySave({
        actorId: user.id,
        now: new Date(),
        learner: {
          gradeType: learner.gradeLevel.type,
          isAralLearner: learner.isAralLearner,
          aralTeacherId: learner.aralTeacherId,
          aralEnrolledAt: learner.aralEnrolledAt,
        },
        existing,
        submitted: {
          mosyLevel: input.mosyLevel,
          decision: input.decision,
          reason: input.reason,
          improvedToLevel: input.improvedToLevel,
          remarks: input.remarks,
        },
        previousFilipinoLevel,
      });
      if (!resolved.ok) {
        if (resolved.failure === "OUT_OF_SCOPE") throw resourceNotFound("Learner");
        const { field, message } = FAILURE_FIELD[resolved.failure];
        throw fieldError(field, message);
      }

      await tx.aralMosyDecision.upsert({
        where: {
          learnerId_schoolYearId: { learnerId: input.learnerId, schoolYearId: schoolYear.id },
        },
        create: {
          schoolId: user.schoolId,
          schoolYearId: schoolYear.id,
          learnerId: input.learnerId,
          ...resolved.row,
        },
        update: resolved.row,
      });
      if (resolved.learnerPatch) {
        await tx.learner.update({
          where: { id: input.learnerId },
          data: resolved.learnerPatch,
        });
      }

      return { resolved, schoolYearId: schoolYear.id, learner };
    });

    const { resolved, schoolYearId, learner } = result;
    const { transition, row } = resolved;

    await writeAudit({
      userId: user.id,
      schoolId: user.schoolId,
      action:
        transition === "MOVED_OUT"
          ? AUDIT_ACTIONS.ARAL_MOSY_MOVE_OUT
          : transition === "RETAGGED"
            ? AUDIT_ACTIONS.ARAL_MOSY_RETAG
            : AUDIT_ACTIONS.ARAL_MOSY_SAVE,
      resource: "AralMosyDecision",
      resourceId: input.learnerId,
      // IDs and codes only — remarks is free text and can carry learner PII.
      metadata: {
        schoolId: user.schoolId,
        learnerId: input.learnerId,
        schoolYearId,
        mosyLevel: row.mosyLevel,
        decision: row.decision,
        reason: row.reason,
        improvedToLevel: row.improvedToLevel,
      },
    });

    revalidatePath(ARAL_MOSY_HREF);
    if (transition !== "NONE") {
      // ARAL membership changed — same surfaces as toggleAralLearner.
      revalidatePath("/teacher/aral");
      revalidatePath(ARAL_PROFILING_HREF);
      revalidatePath("/teacher/learners");
      revalidatePath(`/teacher/grade/${learner.gradeLevelId}`);
      revalidatePath(`/teacher/grade/${learner.gradeLevelId}/learners/${input.learnerId}`);
      revalidateLearnerScoped({
        schoolId: user.schoolId,
        teacherId: learner.teacherId,
        aralTeacherId: user.id,
        teacherShell: true,
      });
    }

    return { ok: true, data: { transition } };
  },
  { verb: "save the MOSY decision" }
);
