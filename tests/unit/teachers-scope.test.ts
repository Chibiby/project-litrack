import { describe, expect, it } from "vitest";
import {
  aralLearnerScope,
  deniesAdvisoryRoster,
  isAralVolunteerDesignation,
  teacherAdvisoryGradeScope,
  teacherCanAccessLearner,
  teacherGradeScope,
  teacherIsAralTutorFor,
  teacherLearnerScope,
} from "@/lib/teachers/scope";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";

const TEACHER = "t1";
const OTHER = "t2";

describe("teacherCanAccessLearner", () => {
  it("grants access to the adviser", () => {
    expect(
      teacherCanAccessLearner({ teacherId: TEACHER, aralTeacherId: null }, TEACHER)
    ).toBe(true);
  });

  it("grants access to the designated ARAL teacher who is not the adviser", () => {
    // The whole point of the second axis: an ARAL-only teacher advises nobody.
    expect(
      teacherCanAccessLearner({ teacherId: OTHER, aralTeacherId: TEACHER }, TEACHER)
    ).toBe(true);
  });

  it("grants access to a floating learner's ARAL teacher (no adviser at all)", () => {
    expect(
      teacherCanAccessLearner({ teacherId: null, aralTeacherId: TEACHER }, TEACHER)
    ).toBe(true);
  });

  it("denies an unrelated teacher", () => {
    expect(
      teacherCanAccessLearner({ teacherId: OTHER, aralTeacherId: OTHER }, TEACHER)
    ).toBe(false);
  });

  it("denies when both pointers are null — null must never match", () => {
    expect(
      teacherCanAccessLearner({ teacherId: null, aralTeacherId: null }, TEACHER)
    ).toBe(false);
  });
});

describe("teacherLearnerScope", () => {
  it("matches adviser OR designated ARAL teacher", () => {
    expect(teacherLearnerScope(TEACHER)).toEqual({
      OR: [{ teacherId: TEACHER }, { aralTeacherId: TEACHER }],
    });
  });
});

describe("teacherAdvisoryGradeScope", () => {
  it("covers the advised section's grade only, not the legacy mirror and not ARAL", () => {
    const where = teacherAdvisoryGradeScope(TEACHER);
    // One branch: `advisorySectionId` is the authoritative axis and it is unique,
    // so the legacy `taughtGrades` mirror can only agree with it or lag behind.
    // It is still dual-written, but it is no longer read for access.
    expect(where.OR).toHaveLength(1);
    expect(where.OR).toEqual([
      { sections: { some: { deletedAt: null, adviser: { id: TEACHER } } } },
    ]);
    expect(JSON.stringify(where)).not.toContain("teachers");
    // Roster operations belong to the adviser — an ARAL designation must not
    // widen who can create or import learners into a grade.
    expect(JSON.stringify(where)).not.toContain("aralTeacherId");
  });

  it("filters out soft-deleted sections", () => {
    expect(JSON.stringify(teacherAdvisoryGradeScope(TEACHER))).toContain(
      '"deletedAt":null'
    );
  });
});

describe("teacherGradeScope", () => {
  it("adds ARAL-designated learners so an ARAL-only teacher can open the grade", () => {
    const where = teacherGradeScope(TEACHER);
    expect(where.OR).toHaveLength(2);
    expect(where.OR).toEqual([
      { sections: { some: { deletedAt: null, adviser: { id: TEACHER } } } },
      { learners: { some: { aralTeacherId: TEACHER, deletedAt: null } } },
    ]);
    // The legacy m2m mirror is not consulted on either axis.
    expect(JSON.stringify(where)).not.toContain("teachers");
  });

  it("is strictly wider than the advisory-only scope", () => {
    const advisory = teacherAdvisoryGradeScope(TEACHER).OR ?? [];
    const full = teacherGradeScope(TEACHER).OR ?? [];
    expect(full).toEqual(expect.arrayContaining(advisory as never[]));
  });

  it("excludes soft-deleted learners from the ARAL branch", () => {
    const where = teacherGradeScope(TEACHER);
    const aralBranch = (where.OR as Record<string, unknown>[])[1];
    expect(aralBranch).toEqual({
      learners: { some: { aralTeacherId: TEACHER, deletedAt: null } },
    });
  });

  it("scopes to the given teacher only", () => {
    expect(JSON.stringify(teacherGradeScope(TEACHER))).not.toContain(OTHER);
  });
});

describe("isAralVolunteerDesignation", () => {
  it("matches the designation constant", () => {
    expect(isAralVolunteerDesignation(ARAL_VOLUNTEER_DESIGNATION)).toBe(true);
  });

  it("does not match a DepEd designation", () => {
    expect(isAralVolunteerDesignation("Teacher I")).toBe(false);
  });

  it("does not match null or undefined", () => {
    // Both reach here: a teacher with no profile row yet, and a shell read that
    // deliberately skipped the query.
    expect(isAralVolunteerDesignation(null)).toBe(false);
    expect(isAralVolunteerDesignation(undefined)).toBe(false);
  });

  it("is an exact comparison, not a substring or case-insensitive one", () => {
    // A looser match would catch a future DepEd designation that merely mentions
    // ARAL and silently strip that teacher's roster.
    expect(isAralVolunteerDesignation("ARAL Volunteer")).toBe(false);
    expect(isAralVolunteerDesignation("non-deped aral volunteer")).toBe(false);
    expect(
      isAralVolunteerDesignation(` ${ARAL_VOLUNTEER_DESIGNATION} `)
    ).toBe(false);
  });
});

describe("deniesAdvisoryRoster", () => {
  it("closes the advisory roster to a Non-DepEd ARAL Volunteer", () => {
    expect(
      deniesAdvisoryRoster({
        isSuperAdmin: false,
        designation: ARAL_VOLUNTEER_DESIGNATION,
      })
    ).toBe(true);
  });

  it("leaves it open to an ordinary DepEd teacher", () => {
    expect(
      deniesAdvisoryRoster({ isSuperAdmin: false, designation: "Teacher III" })
    ).toBe(false);
  });

  it("never closes it to a SUPER_ADMIN — even one carrying the designation", () => {
    // This is the case the guard exists for. A Super Admin passes every role
    // check by impersonation, so the roster must stay reachable regardless of
    // what designation the read happens to return. Today it returns null (no
    // TeacherProfile, so the query is skipped), which makes the `isSuperAdmin`
    // branch look redundant — folding it away would keep the rest of this suite
    // green and lock an admin out the moment that read became unconditional.
    expect(
      deniesAdvisoryRoster({
        isSuperAdmin: true,
        designation: ARAL_VOLUNTEER_DESIGNATION,
      })
    ).toBe(false);
    expect(
      deniesAdvisoryRoster({ isSuperAdmin: true, designation: null })
    ).toBe(false);
  });

  it("fails OPEN when the designation is unknown", () => {
    // The shell read degrades to null on a pool error. Wrongly hiding the roster
    // from an entitled teacher is the worse failure of the two: a volunteer who
    // slips through only sees a page this same predicate refuses on its next
    // successful read, and the roster query is tenant- and teacher-scoped either
    // way, so nothing leaks.
    expect(
      deniesAdvisoryRoster({ isSuperAdmin: false, designation: null })
    ).toBe(false);
    expect(
      deniesAdvisoryRoster({ isSuperAdmin: false, designation: undefined })
    ).toBe(false);
  });

  it("agrees with the nav predicate for every non-admin input", () => {
    // The teacher layout decides `isAralVolunteer` via
    // `isAralVolunteerDesignation` — which now renders the sidebar's `Learners`
    // row inert with a "DepEd only" pill rather than dropping it — while the page
    // gates via this helper. If the two ever disagree for a real teacher, the nav
    // offers a live link into a page that refuses, or greys out a roster the page
    // would have served — both are worse than a wrong-but-consistent answer.
    for (const designation of [
      ARAL_VOLUNTEER_DESIGNATION,
      "Teacher I",
      "Master Teacher II",
      null,
      undefined,
    ]) {
      expect(deniesAdvisoryRoster({ isSuperAdmin: false, designation })).toBe(
        isAralVolunteerDesignation(designation)
      );
    }
  });
});

/**
 * §11 of the ten concerns. `teacherLearnerScope` answers "may this teacher act
 * on the learner" — adviser OR designated ARAL tutor — and every ARAL page used
 * it. So an adviser saw the ARAL learners in their own class on their own ARAL
 * pages even when somebody else was the designated tutor. That is the reported
 * bug, and it is a real correctness bug: the ARAL programme's records were being
 * shown to, and writable by, a teacher who is not running it for that learner.
 *
 * The fix is a SECOND, narrower predicate rather than a change to the first.
 * Narrowing `teacherLearnerScope` would close the advisory roster to advisers —
 * the opposite of what anyone wants, at 19 call sites.
 *
 * These tests are the guard for both halves: that the narrow predicate is narrow,
 * and that the wide one stayed wide. They must fail if either is changed into the
 * other.
 */
describe("aralLearnerScope", () => {
  it("matches the designated ARAL tutor only — advising is not enough", () => {
    expect(aralLearnerScope(TEACHER)).toEqual({ aralTeacherId: TEACHER });
  });

  it("does not look at the advisory pointer at all", () => {
    expect(JSON.stringify(aralLearnerScope(TEACHER))).not.toContain('"teacherId"');
  });

  it("owns no OR key, so it composes into any where", () => {
    // `teacherLearnerScope` owns `OR` and every call site has to know that.
    // This one is a plain equality and carries no such caveat.
    expect(aralLearnerScope(TEACHER)).not.toHaveProperty("OR");
  });

  it("is strictly narrower than teacherLearnerScope", () => {
    const wide = teacherLearnerScope(TEACHER).OR ?? [];
    expect(wide).toEqual(
      expect.arrayContaining([aralLearnerScope(TEACHER) as never])
    );
    expect(wide).toHaveLength(2);
  });

  it("scopes to the given teacher only", () => {
    expect(JSON.stringify(aralLearnerScope(TEACHER))).not.toContain(OTHER);
  });
});

describe("teacherIsAralTutorFor", () => {
  it("admits the designated tutor", () => {
    expect(
      teacherIsAralTutorFor({ teacherId: OTHER, aralTeacherId: TEACHER }, TEACHER)
    ).toBe(true);
  });

  it("admits a tutor of a floating learner who has no adviser", () => {
    expect(
      teacherIsAralTutorFor({ teacherId: null, aralTeacherId: TEACHER }, TEACHER)
    ).toBe(true);
  });

  /** The regression. `teacherCanAccessLearner` says yes here; this must say no. */
  it("refuses the adviser when somebody else is the designated tutor", () => {
    const learner = { teacherId: TEACHER, aralTeacherId: OTHER };
    expect(teacherCanAccessLearner(learner, TEACHER)).toBe(true);
    expect(teacherIsAralTutorFor(learner, TEACHER)).toBe(false);
  });

  it("refuses an adviser of a learner with no designated tutor at all", () => {
    // Nobody is running ARAL for this learner yet. Advising them does not make
    // the adviser the tutor by default — the designation is an explicit act.
    expect(
      teacherIsAralTutorFor({ teacherId: TEACHER, aralTeacherId: null }, TEACHER)
    ).toBe(false);
  });

  it("denies when both pointers are null — null must never match", () => {
    expect(
      teacherIsAralTutorFor({ teacherId: null, aralTeacherId: null }, TEACHER)
    ).toBe(false);
  });
});
