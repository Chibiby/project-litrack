"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdminScope } from "@/lib/auth/district-scope";
import { schoolWhereForScope } from "@/lib/auth/admin-scope";
import { checkRateLimit } from "@/lib/rate-limit";
import { action } from "@/lib/errors/action";
import { resourceNotFound, tooManyAttempts } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { AUDIT_ACTIONS, writeAudit } from "@/lib/audit";
import { archiveRowSchema } from "@/lib/validators/admin-archive.schema";
import { reactivateEnrollment } from "@/lib/learners/reactivate-enrollment";
import { revalidateLearnerScoped } from "@/lib/cache/revalidate";
import { deletedOrExpiredFilter } from "@/lib/learners/deleted-learners";
import { ADMIN_ROUTES } from "@/lib/routes/admin";
import { DISTRICT_ROUTES } from "@/lib/routes/district";

/**
 * Restore a learner who was soft-deleted 30 days after teacher removal.
 *
 * Open to Developer and Division Super Admins (division scope: any school) and
 * District Admins (only schools in their assigned districts). The guard is
 * `requireAdminScope`, which refuses every other role; purge stays Developer-only
 * in `admin-archive.ts`.
 *
 * Scope is part of the learner's WHERE (`school: schoolWhereForScope(scope)`),
 * so an out-of-scope learner is indistinguishable from a missing one: both throw
 * the same NOT_FOUND.
 */

const RESTORE_RATE = { limit: 20, windowMs: 15 * 60 * 1000 } as const;

export type RestoreDeletedLearnerResult = {
  ok: true;
  enrollmentOutcome: "kept" | "revived" | "created" | "no-active-year";
};

export const restoreDeletedLearner = action(
  "restoreDeletedLearner",
  async (formData: FormData): Promise<RestoreDeletedLearnerResult> => {
    const { user, scope } = await requireAdminScope();

    const rate = await checkRateLimit(`admin:deleted-learners:restore:${user.id}`, RESTORE_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs, "RATE_LIMITED");

    const { id } = parseInput(archiveRowSchema, { id: formData.get("id") });

    const learner = await prisma.learner.findFirst({
      where: {
        id,
        OR: deletedOrExpiredFilter(),
        school: { AND: [schoolWhereForScope(scope), { deletedAt: null }] },
      },
      select: {
        id: true,
        schoolId: true,
        gradeLevelId: true,
        sectionId: true,
        teacherId: true,
        aralTeacherId: true,
        isAralLearner: true,
      },
    });
    if (!learner) throw resourceNotFound("Learner");

    const outcome = await prisma.$transaction(async (tx) => {
      // Both fields: with `archivedAt` left set the learner would reappear in the
      // teacher's Removed list with an expired clock and be deleted again tonight.
      await tx.learner.update({
        where: { id: learner.id },
        data: { deletedAt: null, archivedAt: null },
      });
      return reactivateEnrollment(tx, learner);
    });

    await writeAudit({
      userId: user.id,
      schoolId: learner.schoolId,
      action: AUDIT_ACTIONS.ARCHIVE_LEARNER_RESTORE,
      resource: "Learner",
      resourceId: learner.id,
      metadata: {
        schoolId: learner.schoolId,
        scope: scope.kind,
        enrollmentOutcome: outcome.outcome,
        enrollmentId: outcome.enrollmentId,
      },
    });

    revalidateLearnerScoped({
      schoolId: learner.schoolId,
      teacherId: learner.teacherId,
      aralTeacherId: learner.aralTeacherId,
      adminDashboard: true,
      teacherShell: learner.isAralLearner,
    });
    revalidatePath(ADMIN_ROUTES.deletedLearners);
    revalidatePath(DISTRICT_ROUTES.deletedLearners);
    revalidatePath(ADMIN_ROUTES.archive);

    return { ok: true, enrollmentOutcome: outcome.outcome };
  },
  { verb: "restore the learner" }
);
