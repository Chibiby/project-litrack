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
import { resolveMosyAccess } from "@/lib/aral/mosy-access";
import { isMosySubmissionLocked } from "@/lib/settings/system-settings";
import { teacherOwnsMosyRow } from "@/lib/teachers/scope";
import { ARAL_MOSY_HREF, ARAL_PROFILING_HREF } from "@/lib/nav/nav-config";

function formToObj(formData: FormData): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) obj[k] = v;
  return obj;
}

const FAILURE_FIELD: Record<MosySaveFailure, { field: string; message: string }> = {
  LEVEL_NOT_ALLOWED: {
    field: "mosyLevel",
    message: "Choose a reading level that fits this decision",
  },
  REASON_REQUIRED: {
    field: "reason",
    message: "Choose a reason for moving the learner out",
  },
  REASON_NOT_ALLOWED: {
    field: "reason",
    message: "That reason is not available for this learner or reading level",
  },
  DECISION_REQUIRED: {
    field: "decision",
    message: "Choose whether the learner moves out or stays in ARAL",
  },
};

/**
 * Authorization: `requireSchoolUser("TEACHER")`, then in order: Super Admin is
 * read-only (NOT_FOUND, even on a forged post); `MOSY_LOCKED` while the Super
 * Admin submission lock is on (the default); `resolveMosyAccess` refuses
 * volunteers, floating teachers and teachers with no advisory section.
 *
 * Tenancy: `schoolId` on the row comes from the session, `assertSameSchool` on the
 * DB-loaded learner, then advisory scope (`teacherOwnsMosyRow`) is re-checked
 * against the learner row locked inside the transaction: the learner's CURRENT
 * section must be one of the teacher's advisory sections and the learner must be
 * ARAL-tagged or moved out through MOSY this year. Anything else is NOT_FOUND.
 * The decision row and any learner untag / re-tag commit in one transaction.
 */
export const saveMosyDecision = action(
  "saveMosyDecision",
  async (
    formData: FormData
  ): Promise<{ ok: true; data: { transition: MosyTransition } }> => {
    const user = await requireSchoolUser("TEACHER");

    // The Super Admin view is read-only: no whole-school write path exists.
    if (user.role === "SUPER_ADMIN") throw resourceNotFound("Learner");

    if (await isMosySubmissionLocked()) throw new AppError("MOSY_LOCKED");

    const access = await resolveMosyAccess(user);
    if (!access.ok) {
      throw new AppError("VALIDATION_FAILED", { params: { message: access.message } });
    }

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
        select: { id: true },
      });
      if (!schoolYear) throw new AppError("SCHOOL_YEAR_NOT_ACTIVE");

      const learner = await tx.learner.findFirst({
        where: { id: input.learnerId, deletedAt: null, archivedAt: null },
        select: {
          schoolId: true,
          teacherId: true,
          sectionId: true,
          gradeLevelId: true,
          isAralLearner: true,
          aralTeacherId: true,
          aralEnrolledAt: true,
          filipinoReadingProfile: true,
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

      // Advisory scope, on the row we hold the lock on (not the earlier read
      // behind the page): a learner moved to another section since the page
      // rendered is no longer this adviser's. Same "not found" as any other miss.
      if (!teacherOwnsMosyRow(learner, existing, access.sectionIds)) {
        throw resourceNotFound("Learner");
      }

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
        // BOSY level, from the DB-loaded learner (never the client).
        bosyFilipinoLevel: learner.filipinoReadingProfile,
      });
      if (!resolved.ok) {
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
        // The tutor whose ARAL lists changed: the one just untagged, else the actor.
        aralTeacherId: learner.aralTeacherId ?? user.id,
        teacherShell: true,
      });
    }

    return { ok: true, data: { transition } };
  },
  { verb: "save the MOSY decision" }
);
