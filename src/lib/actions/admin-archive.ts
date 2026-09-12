"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { action } from "@/lib/errors/action";
import { resourceNotFound, tooManyAttempts } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { AUDIT_ACTIONS, writeAudit } from "@/lib/audit";
import { archiveRowSchema } from "@/lib/validators/admin-archive.schema";
import { purgeLearnerRecord, purgeTeacherRecord } from "@/lib/archive/purge";
import { reactivateEnrollment } from "@/lib/learners/reactivate-enrollment";
import { originalTeacherEmail } from "@/lib/teachers/removed-email";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  revalidateLearnerScoped,
  revalidateSchoolDashboard,
  revalidateSchoolHeadTeachers,
  revalidateSchoolsList,
  revalidateSchoolTeachers,
  revalidateTeacherCaches,
} from "@/lib/cache/revalidate";

/**
 * The four `/admin/archive` actions — restore or permanently delete one
 * soft-deleted Teacher or Learner row at a time.
 *
 * Greenfield: all four go through `action()` rather than the hand-rolled
 * `{ ok: false, error }` shape `admin-school.ts` still uses. Every one, in
 * order: `requireUser("SUPER_ADMIN")` -> rate limit -> `parseInput` -> load
 * the row with `deletedAt: { not: null }` in the `where` (a live row must
 * never be reachable from this page) -> `$transaction` -> `writeAudit` ->
 * revalidate. Failures are thrown as `AppError`, never returned.
 *
 * `teacherPurgeBlockers` / `ARCHIVE_PURGE_BLOCKED` from the original spec are
 * CANCELLED by explicit project-owner decision: migration
 * `20260912000001_archive_purge_recorder_setnull_and_deleted_at_indexes`
 * made the nine "who recorded this" columns nullable with `ON DELETE
 * SET NULL`, so a teacher purge now always succeeds. Do not reintroduce a
 * blocker check or that error code.
 */

/** Matches `REMOVE_RATE` in `admin-school.ts` — deliberate work, not a hammer. */
const ARCHIVE_RATE = { limit: 20, windowMs: 15 * 60 * 1000 } as const;

async function rateLimitOrThrow(key: string): Promise<void> {
  const rate = await checkRateLimit(key, ARCHIVE_RATE);
  if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs, "RATE_LIMITED");
}

// ── Learner ────────────────────────────────────────────────────────────────

export type RestoreRemovedLearnerResult = {
  ok: true;
  enrollmentOutcome: "kept" | "revived" | "created" | "no-active-year";
};

/**
 * Restore a soft-deleted learner's record and bring its enrollment back in
 * line with the active school year via `reactivateEnrollment` — the same
 * function `restoreLearner`'s `archivedAt` path uses, so the two restore
 * paths cannot disagree about what "back" means.
 *
 * Refuses `NOT_FOUND` when the learner's school is itself soft-deleted:
 * restoring into a dead tenant would produce a row nobody can see or manage
 * (spec section 4a). Purge of such a learner is still allowed.
 */
export const restoreRemovedLearner = action(
  "restoreRemovedLearner",
  async (formData: FormData): Promise<RestoreRemovedLearnerResult> => {
    const admin = await requireUser("SUPER_ADMIN");
    await rateLimitOrThrow(`admin:archive:restore-learner:${admin.id}`);

    const { id } = parseInput(archiveRowSchema, { id: formData.get("id") });

    const learner = await prisma.learner.findFirst({
      where: { id, deletedAt: { not: null } },
      select: {
        id: true,
        schoolId: true,
        gradeLevelId: true,
        sectionId: true,
        teacherId: true,
        aralTeacherId: true,
        isAralLearner: true,
        school: { select: { deletedAt: true } },
      },
    });
    if (!learner) throw resourceNotFound("Learner");
    if (learner.school.deletedAt) throw resourceNotFound("Learner");

    const outcome = await prisma.$transaction(async (tx) => {
      await tx.learner.update({ where: { id: learner.id }, data: { deletedAt: null } });
      return reactivateEnrollment(tx, learner);
    });

    await writeAudit({
      userId: admin.id,
      schoolId: learner.schoolId,
      action: AUDIT_ACTIONS.ARCHIVE_LEARNER_RESTORE,
      resource: "Learner",
      resourceId: learner.id,
      metadata: {
        schoolId: learner.schoolId,
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
    revalidateSchoolsList();
    revalidatePath("/admin/archive");
    revalidatePath(`/admin/schools/${learner.schoolId}`);

    return { ok: true, enrollmentOutcome: outcome.outcome };
  },
  { verb: "restore the learner" }
);

export type PurgeRemovedLearnerResult = { ok: true };

/**
 * Permanently delete a soft-deleted learner and everything that cascades
 * from it (spec section 2a). Counts are read before the delete so the audit
 * row can name what went.
 */
export const purgeRemovedLearner = action(
  "purgeRemovedLearner",
  async (formData: FormData): Promise<PurgeRemovedLearnerResult> => {
    const admin = await requireUser("SUPER_ADMIN");
    await rateLimitOrThrow(`admin:archive:purge-learner:${admin.id}`);

    const { id } = parseInput(archiveRowSchema, { id: formData.get("id") });

    const learner = await prisma.learner.findFirst({
      where: { id, deletedAt: { not: null } },
      select: {
        id: true,
        schoolId: true,
        teacherId: true,
        aralTeacherId: true,
        isAralLearner: true,
      },
    });
    if (!learner) throw resourceNotFound("Learner");

    const counts = await prisma.$transaction((tx) => purgeLearnerRecord(tx, learner.id));

    await writeAudit({
      userId: admin.id,
      schoolId: learner.schoolId,
      action: AUDIT_ACTIONS.ARCHIVE_LEARNER_PURGE,
      resource: "Learner",
      resourceId: learner.id,
      metadata: { schoolId: learner.schoolId, counts },
    });

    revalidateLearnerScoped({
      schoolId: learner.schoolId,
      teacherId: learner.teacherId,
      aralTeacherId: learner.aralTeacherId,
      adminDashboard: true,
      teacherShell: learner.isAralLearner,
    });
    revalidateSchoolsList();
    revalidatePath("/admin/archive");
    revalidatePath(`/admin/schools/${learner.schoolId}`);

    return { ok: true };
  },
  { verb: "delete the learner" }
);

// ── Teacher ────────────────────────────────────────────────────────────────

export type RestoreRemovedTeacherResult = {
  ok: true;
  /** The account cannot sign in yet — see spec section 4b. */
  needsCredentials: true;
  emailRestored: boolean;
};

/**
 * Restore a soft-deleted teacher's RECORD, never their login (spec 4b).
 *
 * `deletedAt: null` only. `isActive` stays `false` — that is what keeps
 * `getCurrentUser` refusing the session — `approvalStatus` is untouched, no
 * advisory or learner is re-attached, and no Supabase admin client is ever
 * constructed on this path: `authId` is left as the dangling string removal
 * left behind, which is inert because nothing can present a session for it.
 *
 * The email is restored to the original only when `originalTeacherEmail`
 * finds one AND no live `User` already holds it — checked inside this same
 * transaction because `email` is `@unique`. Otherwise the tombstone stays,
 * on purpose: it is what frees the address for the teacher to register again.
 */
export const restoreRemovedTeacher = action(
  "restoreRemovedTeacher",
  async (formData: FormData): Promise<RestoreRemovedTeacherResult> => {
    const admin = await requireUser("SUPER_ADMIN");
    await rateLimitOrThrow(`admin:archive:restore-teacher:${admin.id}`);

    const { id } = parseInput(archiveRowSchema, { id: formData.get("id") });

    const teacher = await prisma.user.findFirst({
      where: { id, role: "TEACHER", deletedAt: { not: null } },
      select: { id: true, schoolId: true, email: true, school: { select: { deletedAt: true } } },
    });
    if (!teacher) throw resourceNotFound("Teacher");
    if (teacher.school && teacher.school.deletedAt) throw resourceNotFound("Teacher");

    const emailRestored = await prisma.$transaction(async (tx) => {
      const candidate = originalTeacherEmail(teacher.email);
      let restoreEmail: string | null = null;
      if (candidate && candidate !== teacher.email) {
        const taken = await tx.user.findFirst({
          where: { email: candidate, NOT: { id: teacher.id } },
          select: { id: true },
        });
        if (!taken) restoreEmail = candidate;
      }

      await tx.user.update({
        where: { id: teacher.id },
        data: {
          deletedAt: null,
          ...(restoreEmail ? { email: restoreEmail } : {}),
        },
      });

      return restoreEmail !== null;
    });

    await writeAudit({
      userId: admin.id,
      schoolId: teacher.schoolId,
      action: AUDIT_ACTIONS.ARCHIVE_TEACHER_RESTORE,
      resource: "User",
      resourceId: teacher.id,
      metadata: { schoolId: teacher.schoolId, emailRestored, needsCredentials: true },
    });

    if (teacher.schoolId) {
      revalidateSchoolTeachers(teacher.schoolId);
      revalidateSchoolDashboard(teacher.schoolId);
      revalidateSchoolHeadTeachers(teacher.schoolId);
    }
    revalidateSchoolsList();
    revalidateTeacherCaches(teacher.id);
    revalidatePath("/admin/archive");
    if (teacher.schoolId) revalidatePath(`/admin/schools/${teacher.schoolId}`);

    return { ok: true, needsCredentials: true, emailRestored };
  },
  { verb: "restore the account" }
);

export type PurgeRemovedTeacherResult = { ok: true; authDeleted: boolean };

/**
 * Permanently delete a soft-deleted teacher's `User` row.
 *
 * Ordering is deliberately the reverse of `clearRejectedTeacher`
 * (`src/lib/actions/school-head.ts`), which deletes the Supabase user first
 * and has to apologise if Prisma fails afterwards:
 * 1. Load the row (already done above) and its counts (inside the tx, via
 *    `purgeTeacherRecord`).
 * 2. `purgeTeacherRecord` releases advisory + learners, nulls
 *    `advisorySectionId`, then deletes the `User` row — all inside one
 *    transaction.
 * 3. Only AFTER that transaction commits: a best-effort Supabase
 *    `auth.admin.deleteUser(authId)`, tolerating "not found" exactly as
 *    `removeTeacherRows` does.
 *
 * If step 3 fails, an auth user survives with no Prisma row. That grants no
 * access: `getCurrentUser` resolves a session by `authId` against `User` and
 * returns null when nothing matches, so a dangling auth user with no row is
 * inert, and a repeat purge attempt (now `NOT_FOUND` on the Prisma side)
 * would be the operator's next step if the leftover is ever noticed.
 */
export const purgeRemovedTeacher = action(
  "purgeRemovedTeacher",
  async (formData: FormData): Promise<PurgeRemovedTeacherResult> => {
    const admin = await requireUser("SUPER_ADMIN");
    await rateLimitOrThrow(`admin:archive:purge-teacher:${admin.id}`);

    const { id } = parseInput(archiveRowSchema, { id: formData.get("id") });

    const teacher = await prisma.user.findFirst({
      where: { id, role: "TEACHER", deletedAt: { not: null } },
      select: { id: true, schoolId: true, authId: true },
    });
    if (!teacher) throw resourceNotFound("Teacher");

    // A teacher row with no school (orphaned by a hard School delete) has no
    // advisory/Section state to release; `purgeTeacherRecord` skips that step
    // for a null `schoolId` and still deletes the row — purging orphans is
    // the point of this page, not something to refuse.
    const result = await prisma.$transaction((tx) =>
      purgeTeacherRecord(tx, { teacherId: teacher.id, schoolId: teacher.schoolId })
    );

    let authDeleted = false;
    try {
      const supabase = createSupabaseAdminClient();
      const { error } = await supabase.auth.admin.deleteUser(teacher.authId);
      authDeleted = !error;
      if (error && !/not.?found/i.test(error.message)) {
        console.error("[purgeRemovedTeacher] Supabase deleteUser failed:", error.message);
      }
    } catch (err) {
      console.error("[purgeRemovedTeacher] Supabase deleteUser threw:", err);
    }

    await writeAudit({
      userId: admin.id,
      schoolId: teacher.schoolId,
      action: AUDIT_ACTIONS.ARCHIVE_TEACHER_PURGE,
      resource: "User",
      resourceId: teacher.id,
      metadata: {
        schoolId: teacher.schoolId,
        counts: result.counts,
        releasedSectionIds: result.releasedSectionIds,
        releasedLearnerCount: result.releasedLearnerCount,
        authDeleted,
      },
    });

    if (teacher.schoolId) {
      revalidateSchoolTeachers(teacher.schoolId);
      revalidateSchoolDashboard(teacher.schoolId);
      revalidateSchoolHeadTeachers(teacher.schoolId);
      revalidatePath(`/admin/schools/${teacher.schoolId}`);
    }
    revalidateSchoolsList();
    revalidateTeacherCaches(teacher.id);
    revalidatePath("/admin/archive");

    return { ok: true, authDeleted };
  },
  { verb: "delete the account" }
);
