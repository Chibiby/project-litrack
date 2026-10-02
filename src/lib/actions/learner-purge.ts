"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import { assertSameSchool } from "@/lib/auth/tenant";
import { checkRateLimit } from "@/lib/rate-limit";
import { action } from "@/lib/errors/action";
import { fieldError, resourceNotFound, tooManyAttempts } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { AUDIT_ACTIONS, writeAudit } from "@/lib/audit";
import { purgeLearnerRecord } from "@/lib/archive/purge";
import { normalizePersonName } from "@/lib/learners/normalize";
import { teacherCanAccessLearner, teacherLearnerScope } from "@/lib/teachers/scope";
import { revalidateLearnerScoped } from "@/lib/cache/revalidate";

type ActionResult = { ok: true };

/** Same budget as the Developer Admin purge: deliberate work, not a hammer. */
const PURGE_RATE = { limit: 20, windowMs: 15 * 60 * 1000 } as const;

const purgeArchivedLearnerSchema = z.object({
  id: z.string().uuid("Learner id required"),
  confirmName: z.string().trim().max(200, "Name is too long"),
});

/**
 * Permanently delete ONE archived (or old-style removed) learner from the
 * teacher's Archived Learners tab. Cannot be undone; the teacher confirms by
 * typing the learner's name.
 *
 * Reach is identical to `restoreLearner`: the learner must be archived/removed
 * (an active learner is NOT_FOUND), in the caller's school, and the caller must
 * be the adviser or designated ARAL teacher. A Super Admin passes
 * `requireSchoolUser` but is neither pointer, so is refused as NOT_FOUND here —
 * Super Admins purge from `/admin/archive` instead.
 */
export const purgeArchivedLearner = action(
  "purgeArchivedLearner",
  async (formData: FormData): Promise<ActionResult> => {
    const user = await requireSchoolUser("TEACHER");

    const rate = await checkRateLimit(`teacher:learner:purge:${user.id}`, PURGE_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs, "RATE_LIMITED");

    const input = parseInput(purgeArchivedLearnerSchema, {
      id: formData.get("id"),
      confirmName: formData.get("confirmName") ?? "",
    });

    const learner = await prisma.learner.findFirst({
      where: {
        id: input.id,
        schoolId: user.schoolId,
        OR: [{ archivedAt: { not: null } }, { deletedAt: { not: null } }],
      },
      select: {
        id: true,
        schoolId: true,
        fullName: true,
        teacherId: true,
        aralTeacherId: true,
        isAralLearner: true,
        gradeLevelId: true,
      },
    });
    if (!learner) throw resourceNotFound("Learner");

    assertSameSchool(user.schoolId, learner.schoolId, "Learner");
    if (!teacherCanAccessLearner(learner, user.id)) throw resourceNotFound("Learner");

    if (normalizePersonName(input.confirmName) !== normalizePersonName(learner.fullName)) {
      throw fieldError("confirmName", "Type the learner's name exactly to confirm");
    }

    // Re-check inside the transaction under a row lock: `purgeLearnerRecord`
    // deletes by id whatever the state, so a restore that lands between the
    // read above and this delete would otherwise destroy an ACTIVE learner.
    const counts = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Learner" WHERE "id" = ${learner.id} FOR UPDATE`;
      const stillArchived = await tx.learner.findFirst({
        where: {
          id: learner.id,
          schoolId: user.schoolId,
          // Archived-or-removed AND adviser-or-ARAL-tutor: both `OR`s, so they
          // sit in an `AND` rather than competing for one key.
          AND: [
            { OR: [{ archivedAt: { not: null } }, { deletedAt: { not: null } }] },
            teacherLearnerScope(user.id),
          ],
        },
        select: { id: true },
      });
      if (!stillArchived) throw resourceNotFound("Learner");
      return purgeLearnerRecord(tx, learner.id, { acceptArchived: true });
    });

    await writeAudit({
      userId: user.id,
      schoolId: user.schoolId,
      action: AUDIT_ACTIONS.ARCHIVE_LEARNER_PURGE,
      resource: "Learner",
      resourceId: learner.id,
      metadata: { schoolId: user.schoolId, counts, by: "TEACHER" },
    });

    revalidatePath(`/teacher/grade/${learner.gradeLevelId}`);
    revalidatePath("/teacher/learners");
    revalidatePath("/teacher/aral");
    revalidatePath("/admin/archive");
    revalidateLearnerScoped({
      schoolId: learner.schoolId,
      teacherId: learner.teacherId,
      aralTeacherId: learner.aralTeacherId,
      adminDashboard: true,
      teacherShell: learner.isAralLearner,
    });

    return { ok: true };
  },
  { verb: "remove the learner" }
);
