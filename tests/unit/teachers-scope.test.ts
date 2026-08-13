import { describe, expect, it } from "vitest";
import {
  teacherAdvisoryGradeScope,
  teacherCanAccessLearner,
  teacherGradeScope,
  teacherLearnerScope,
} from "@/lib/teachers/scope";

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
  it("covers the legacy m2m mirror and the advised section's grade, but not ARAL", () => {
    const where = teacherAdvisoryGradeScope(TEACHER);
    expect(where.OR).toHaveLength(2);
    expect(where.OR).toEqual([
      { teachers: { some: { id: TEACHER } } },
      { sections: { some: { deletedAt: null, adviser: { id: TEACHER } } } },
    ]);
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
    expect(where.OR).toHaveLength(3);
    expect(where.OR).toEqual([
      { teachers: { some: { id: TEACHER } } },
      { sections: { some: { deletedAt: null, adviser: { id: TEACHER } } } },
      { learners: { some: { aralTeacherId: TEACHER, deletedAt: null } } },
    ]);
  });

  it("is strictly wider than the advisory-only scope", () => {
    const advisory = teacherAdvisoryGradeScope(TEACHER).OR ?? [];
    const full = teacherGradeScope(TEACHER).OR ?? [];
    expect(full).toEqual(expect.arrayContaining(advisory as never[]));
  });

  it("excludes soft-deleted learners from the ARAL branch", () => {
    const where = teacherGradeScope(TEACHER);
    const aralBranch = (where.OR as Record<string, unknown>[])[2];
    expect(aralBranch).toEqual({
      learners: { some: { aralTeacherId: TEACHER, deletedAt: null } },
    });
  });

  it("scopes to the given teacher only", () => {
    expect(JSON.stringify(teacherGradeScope(TEACHER))).not.toContain(OTHER);
  });
});
