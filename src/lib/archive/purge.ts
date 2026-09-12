import "server-only";
import type { Prisma, PrismaClient } from "@prisma/client";
import { releaseTeacherAdvisory } from "@/lib/teachers/release-advisory";
import { resourceNotFound } from "@/lib/errors/app-error";

/**
 * The permanent-delete half of `/admin/archive` (spec sections 2 and 5-6).
 *
 * Pure data-layer helpers only: no auth guard, no rate limit, no audit write,
 * no Supabase call. `src/lib/actions/admin-archive.ts` wires all of that
 * around these functions inside its own `requireUser` / transaction / audit
 * sequence, so this file stays unit-testable against a mocked
 * `Prisma.TransactionClient`.
 *
 * The nine `ON DELETE RESTRICT` "who recorded this" columns named in the spec
 * (`Attendance.recordedById`, `TermGrade.recordedById`, etc.) were made
 * nullable with `ON DELETE SET NULL` by migration
 * `20260912000001_archive_purge_recorder_setnull_and_deleted_at_indexes`. A
 * teacher purge is therefore never refused — there is no blocker set to
 * compute or enforce here, and none should be added back without a matching
 * schema change.
 */

type Client = PrismaClient | Prisma.TransactionClient;

// ── Learner ────────────────────────────────────────────────────────────────

export type LearnerPurgeCounts = {
  enrollment: number;
  attendance: number;
  readingLevelRecord: number;
  termGrade: number;
  aralProfile: number;
};

/**
 * What a learner purge takes with it. Every one of these cascades from
 * `Learner` (spec 2a), so the purge itself is a single `delete()` — these
 * counts exist purely to tell the admin what that delete removes, read
 * *before* the delete so they still reflect the pre-delete world.
 */
export async function learnerPurgeCounts(
  client: Client,
  learnerId: string
): Promise<LearnerPurgeCounts> {
  const [enrollment, attendance, readingLevelRecord, termGrade, aralProfile] = await Promise.all([
    client.enrollment.count({ where: { learnerId } }),
    client.attendance.count({ where: { learnerId } }),
    client.readingLevelRecord.count({ where: { learnerId } }),
    client.termGrade.count({ where: { learnerId } }),
    client.aralProfile.count({ where: { learnerId } }),
  ]);
  return { enrollment, attendance, readingLevelRecord, termGrade, aralProfile };
}

/**
 * A learner purge is a single `prisma.learner.delete()` — nothing blocks it,
 * nothing needs clearing by hand (spec 2a). Counts are read first so the
 * caller has something to put in the audit row after the row is gone.
 */
export async function purgeLearnerRecord(
  tx: Prisma.TransactionClient,
  learnerId: string
): Promise<LearnerPurgeCounts> {
  const counts = await learnerPurgeCounts(tx, learnerId);
  // The `deletedAt IS NOT NULL` guard has to live on the write, not only on
  // the caller's earlier `findFirst` — a live row must never be reachable
  // from this page, and the read and the delete are not the same statement.
  const { count } = await tx.learner.deleteMany({
    where: { id: learnerId, deletedAt: { not: null } },
  });
  if (count !== 1) throw resourceNotFound("Learner");
  return counts;
}

// ── Teacher ────────────────────────────────────────────────────────────────

export type TeacherPurgeCounts = {
  teacherSection: number;
  notification: number;
  chatMessage: number;
  chatMention: number;
  chatRead: number;
  supportTicket: number;
  unlockGrant: number;
};

/**
 * Rows a teacher purge destroys outright via `ON DELETE CASCADE` (spec 2b) —
 * read before the delete purely so the audit row can name what went with the
 * account. Two of these destroy content others can see (chat messages,
 * support tickets); accepted per spec, named here so it is never a surprise.
 */
export async function teacherPurgeCounts(
  client: Client,
  teacherId: string
): Promise<TeacherPurgeCounts> {
  const [teacherSection, notification, chatMessage, chatMention, chatRead, supportTicket, unlockGrant] =
    await Promise.all([
      client.teacherSection.count({ where: { teacherId } }),
      client.notification.count({ where: { recipientId: teacherId } }),
      client.chatMessage.count({ where: { authorId: teacherId } }),
      client.chatMention.count({ where: { userId: teacherId } }),
      client.chatRead.count({ where: { userId: teacherId } }),
      client.supportTicket.count({ where: { requesterId: teacherId } }),
      client.unlockGrant.count({ where: { userId: teacherId } }),
    ]);
  return { teacherSection, notification, chatMessage, chatMention, chatRead, supportTicket, unlockGrant };
}

export type TeacherPurgeResult = {
  counts: TeacherPurgeCounts;
  releasedSectionIds: string[];
  releasedLearnerCount: number;
};

/**
 * Purge a teacher's `User` row, resolving the one relation that does NOT
 * cascade or set-null on its own: `Learner.teacherId` is `ON DELETE
 * RESTRICT` (spec 2b), so a hard delete while any learner still names this
 * teacher as adviser would fail with P2003.
 *
 * `schoolId` is `null` for a teacher row orphaned by a hard School delete
 * (`User.schoolId` is an optional relation) — such a row has no advisory or
 * Section state left to release, so `releaseTeacherAdvisory` (which is
 * schoolId-scoped) is skipped rather than refused; the unscoped learner
 * clear and the delete still run, which is the whole point of letting the
 * page purge orphans.
 *
 * Order, inside the caller's transaction:
 * 1. `releaseTeacherAdvisory` when there is a school to scope it to — the
 *    same helper both soft-delete paths use, so a live adviser release and a
 *    purge release can never disagree.
 * 2. An unscoped `Learner.teacherId` null. When `schoolId` is set this is a
 *    belt to that helper's scoped clear (every row it can touch already
 *    names the teacher about to be deleted, so it cannot cross a tenant
 *    boundary by construction — in practice it finds nothing more). When
 *    `schoolId` is null this is the only clear that runs.
 * 3. `User.advisorySectionId` nulled explicitly — a plain `@unique` column
 *    with no FK, following `src/lib/demo/teardown.ts`. Load-bearing (not
 *    dead) for the `schoolId === null` path: `releaseTeacherAdvisory`, and
 *    the `setTeacherAdvisory` clear inside it, never ran above.
 * 4. `tx.user.delete()`.
 *
 * Does NOT touch Supabase. The caller deletes the auth user AFTER this
 * transaction commits, best-effort, per spec 5 — never before, so a Prisma
 * failure never leaves a live login with no application row.
 */
export async function purgeTeacherRecord(
  tx: Prisma.TransactionClient,
  params: { teacherId: string; schoolId: string | null }
): Promise<TeacherPurgeResult> {
  const { teacherId, schoolId } = params;

  const counts = await teacherPurgeCounts(tx, teacherId);

  const released = schoolId
    ? await releaseTeacherAdvisory(tx, { teacherId, schoolId })
    : { sectionIds: [] as string[], learnerCount: 0 };

  const unscopedRelease = await tx.learner.updateMany({
    where: { teacherId },
    data: { teacherId: null },
  });

  await tx.user.update({ where: { id: teacherId }, data: { advisorySectionId: null } });

  const { count } = await tx.user.deleteMany({
    where: { id: teacherId, deletedAt: { not: null } },
  });
  if (count !== 1) throw resourceNotFound("Teacher");

  return {
    counts,
    releasedSectionIds: released.sectionIds,
    releasedLearnerCount: schoolId ? released.learnerCount : unscopedRelease.count,
  };
}
