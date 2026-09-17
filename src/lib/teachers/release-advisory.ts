import type { Prisma } from "@prisma/client";
import { setTeacherAdvisory } from "@/lib/teachers/section-assignment";

type Tx = Prisma.TransactionClient;

export type ReleasedAdvisory = {
  /** The live sections this teacher advised, now Unassigned. */
  sectionIds: string[];
  /** Learners whose adviser pointer was cleared. */
  learnerCount: number;
};

/**
 * Hand back everything a departing teacher advised, inside the caller's
 * transaction. Used by both removal paths — the School Head's per-row Remove and
 * the Super Admin's bulk removal — so the two cannot disagree about what removal
 * leaves behind.
 *
 * Removal is a soft delete, so no foreign-key action ever fires: without this,
 * `Section.adviserId` keeps naming a teacher who can no longer sign in, the
 * section never reads as Unassigned, and the refusal in `setTeacherAdvisory`
 * (which only claims an adviser-free section) makes it unassignable forever.
 *
 * Four pointers are cleared, and they have to move together:
 *   - `Section.adviserId`, through `setTeacherAdvisory`'s `clear`, so the legacy
 *     `advisorySectionId` / `TeacherSection` / `taughtGrades` mirrors follow.
 *   - `Learner.teacherId` — their advisory learners are left adviser-less, the
 *     same state a floating learner is already in, until the section gets a new
 *     adviser (who picks them up; see `setTeacherAdvisory`'s `add`).
 *   - `Learner.aralTeacherId`, for the same learners — `setTeacherAdvisory`'s
 *     `clear` drops it section-by-section for every section this teacher gave
 *     up, so a departing adviser stops being listed as anyone's ARAL tutor for
 *     a roster they no longer hold. A School Head re-designates a tutor after.
 *   - `Enrollment.teacherId` on the ACTIVE row only, so it keeps agreeing with
 *     the learner row. Closed enrolments are history and keep who advised them.
 *
 * The learner/enrolment sweep below runs BEFORE `setTeacherAdvisory`'s `clear`,
 * deliberately: `clear` now performs this same release itself, section by
 * section, so if it ran first there would be nothing left here to count —
 * `learnerCount` would silently read 0. Doing it here first, while `teacherId`
 * still names them, makes this sweep the one source of truth for the count;
 * `clear`'s own release then finds those rows already null and is a no-op for
 * them, plus a real (idempotent) catch for any learner whose `aralTeacherId`
 * points here without being tied to a section this teacher currently advises.
 *
 * Every write is scoped to `schoolId` — the tenant boundary, never optional.
 */
export async function releaseTeacherAdvisory(
  tx: Tx,
  params: { teacherId: string; schoolId: string }
): Promise<ReleasedAdvisory> {
  const { teacherId, schoolId } = params;

  // Read before the clear: afterwards there is nothing left to name.
  const held = await tx.section.findMany({
    where: { adviserId: teacherId, schoolId, deletedAt: null },
    select: { id: true },
  });

  const learners = await tx.learner.updateMany({
    where: { teacherId, schoolId },
    data: { teacherId: null },
  });
  await tx.enrollment.updateMany({
    where: { teacherId, schoolId, status: "ACTIVE" },
    data: { teacherId: null },
  });

  await setTeacherAdvisory(tx, { teacherId, schoolId, change: { op: "clear" } });

  return { sectionIds: held.map((s) => s.id), learnerCount: learners.count };
}
