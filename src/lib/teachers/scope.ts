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
 * The grade is derived from the section they advise — `User.advisorySectionId` is
 * the authoritative axis, and it is `@unique`, so this resolves to at most one
 * grade. Deliberately excludes ARAL: use it for roster operations (create/import a
 * learner, roster export) that belong to the adviser and not to an ARAL tracker.
 *
 * A teacher with no advisory section matches nothing, by design. The interface
 * says so and names the fix rather than showing a blank page.
 *
 * Owns the `OR` key: spread it into a `where` that has no `OR` of its own.
 */
export function teacherAdvisoryGradeScope(
  teacherId: string
): Prisma.GradeLevelWhereInput {
  return {
    OR: [{ sections: { some: { deletedAt: null, adviser: { id: teacherId } } } }],
  };
}

/**
 * `where` fragment for "grade levels this teacher may open".
 *
 * Union of the two axes a teacher can hold:
 *   1. the grade of the section they advise — the authoritative axis.
 *   2. any grade holding a learner whose designated ARAL teacher they are —
 *      this is what lets an ARAL-only teacher (no advisory section) reach the
 *      ARAL pages for that grade.
 *
 * The legacy `taughtGrades` m2m mirror is NOT consulted. It is still dual-written
 * by `setTeacherAdvisory` for now, but it is no longer read for access anywhere:
 * `advisorySectionId` is `@unique` and that write strips every other section link,
 * so the mirror can only ever agree with the advisory pointer or lag behind it.
 *
 * A teacher who advises nothing and tutors nobody matches no grades. That is the
 * intended outcome, not a gap — see `teacherAdvisoryGradeScope`.
 *
 * Owns the `OR` key, same caveat as `teacherLearnerScope`.
 */
export function teacherGradeScope(teacherId: string): Prisma.GradeLevelWhereInput {
  return {
    OR: [
      { sections: { some: { deletedAt: null, adviser: { id: teacherId } } } },
      { learners: { some: { aralTeacherId: teacherId, deletedAt: null } } },
    ],
  };
}
