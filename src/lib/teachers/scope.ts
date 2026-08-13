import type { Prisma } from "@prisma/client";

/**
 * The two teacher pointers on a learner. Wave 1 split the single
 * `Learner.teacherId` into two independent axes:
 *
 *   - `teacherId`      adviser (via the section they advise). Null for a
 *                      floating learner.
 *   - `aralTeacherId`  designated ARAL teacher. May be a teacher with no
 *                      advisory section at all.
 *
 * A teacher may act on a learner when they are EITHER of those. Both pointers
 * are nullable, so `learner.teacherId !== user.id` still type-checks while
 * silently locking every ARAL-only teacher out — always go through the helpers
 * in this module instead of comparing by hand.
 */
export type LearnerTeacherRefs = {
  teacherId: string | null;
  aralTeacherId: string | null;
};

/** True when `teacherId` advises the learner or is their designated ARAL teacher. */
export function teacherCanAccessLearner(
  learner: LearnerTeacherRefs,
  teacherId: string
): boolean {
  return learner.teacherId === teacherId || learner.aralTeacherId === teacherId;
}

/**
 * `where` fragment for "learners this teacher may act on" — adviser OR
 * designated ARAL teacher.
 *
 * Owns the `OR` key: spread it into a `where` that has no `OR` of its own
 * (every current call site qualifies), or nest it inside an `AND`.
 */
export function teacherLearnerScope(teacherId: string): Prisma.LearnerWhereInput {
  return { OR: [{ teacherId }, { aralTeacherId: teacherId }] };
}

/**
 * `where` fragment for "grade levels this teacher advises in".
 *
 * Union of the legacy `taughtGrades` m2m mirror (still dual-written; backfill
 * "losers" who lost a contested section keep those rows) and the grade derived
 * from the section they actually advise. Deliberately excludes ARAL — use it for
 * roster operations (create/import a learner, roster export) that belong to the
 * adviser and not to an ARAL tracker.
 *
 * Owns the `OR` key: spread it into a `where` that has no `OR` of its own.
 */
export function teacherAdvisoryGradeScope(
  teacherId: string
): Prisma.GradeLevelWhereInput {
  return {
    OR: [
      { teachers: { some: { id: teacherId } } },
      { sections: { some: { deletedAt: null, adviser: { id: teacherId } } } },
    ],
  };
}

/**
 * `where` fragment for "grade levels this teacher may open".
 *
 * Union of three sources, deliberately additive so no legacy account loses
 * access:
 *   1. `taughtGrades` — the legacy m2m mirror, still dual-written. Backfill
 *      "losers" (teachers who lost a contested section) keep these rows.
 *   2. the grade of the section they actually advise — the authoritative axis.
 *   3. any grade holding a learner whose designated ARAL teacher they are —
 *      this is what lets an ARAL-only teacher (no advisory section) reach the
 *      ARAL pages for that grade.
 *
 * Owns the `OR` key, same caveat as `teacherLearnerScope`.
 */
export function teacherGradeScope(teacherId: string): Prisma.GradeLevelWhereInput {
  return {
    OR: [
      { teachers: { some: { id: teacherId } } },
      { sections: { some: { deletedAt: null, adviser: { id: teacherId } } } },
      { learners: { some: { aralTeacherId: teacherId, deletedAt: null } } },
    ],
  };
}
