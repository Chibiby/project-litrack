import { describe, expect, it } from "vitest";
import {
  resolveAdvisoryGradeScope,
  advisoryGradeLevelIds,
  resolveAdvisoryTarget,
  NO_ADVISORY_MESSAGE,
  NOT_YOUR_ADVISORY_MESSAGE,
  type AdvisoryPlacement,
} from "@/lib/teachers/advisory";
import { MAX_ADVISORY_SECTIONS } from "@/lib/teachers/advisory-limits";

/**
 * §4 of the ten concerns, at the point where a teacher who advises three
 * sections has to write into exactly one of them.
 *
 * The rule this pins is the one that could quietly go wrong. Before
 * multi-advisory, "the teacher's section" was unambiguous, and every action that
 * created a learner or opened a term sheet leaned on that. With three, taking
 * the first would still typecheck, still return a placement, and still write
 * successfully — into whichever class happened to sort first. Nobody would see
 * an error; somebody would eventually notice a learner sitting in the wrong
 * room. So "several, and none named" is a refusal, and this file is what says
 * it must stay one.
 *
 * Pure, so it needs no database: the resolution is a decision about a list, and
 * keeping it that way is what lets every caller share it.
 */

function placement(over: Partial<AdvisoryPlacement> = {}): AdvisoryPlacement {
  return {
    sectionId: "section-sampaguita",
    sectionName: "Sampaguita",
    gradeLevelId: "grade-g4",
    gradeType: "G4",
    gradeLabel: "Grade 4",
    label: "Grade 4 · Sampaguita",
    ...over,
  };
}

const ROSAL = placement({
  sectionId: "section-rosal",
  sectionName: "Rosal",
  label: "Grade 4 · Rosal",
});

describe("resolveAdvisoryTarget — no advisory", () => {
  it("refuses with the shared no-advisory message", () => {
    const target = resolveAdvisoryTarget([]);

    expect(target).toEqual({
      ok: false,
      reason: "none",
      error: NO_ADVISORY_MESSAGE,
    });
  });

  it("refuses even when a section is named, without confirming it exists", () => {
    // A teacher who advises nothing must not learn anything about a section id
    // they posted — the answer is the same one they get for posting none.
    expect(resolveAdvisoryTarget([], "section-rosal")).toMatchObject({
      reason: "none",
      error: NO_ADVISORY_MESSAGE,
    });
  });
});

describe("resolveAdvisoryGradeScope", () => {
  const GRADE_FIVE = placement({
    sectionId: "section-rosal",
    sectionName: "Rosal",
    gradeLevelId: "grade-g5",
    gradeType: "G5",
    gradeLabel: "Grade 5",
    label: "Grade 5 · Rosal",
  });
  /** A second section in the SAME grade as `placement()`. */
  const SAME_GRADE_TWIN = placement({
    sectionId: "section-ilang",
    sectionName: "Ilang-Ilang",
    label: "Grade 4 · Ilang-Ilang",
  });

  it("resolves the one placement in the grade the URL names", () => {
    const scope = resolveAdvisoryGradeScope([placement(), GRADE_FIVE], "grade-g5");
    expect(scope).toEqual({ kind: "placement", placement: GRADE_FIVE });
  });

  it("works across different grades, not just the first one held", () => {
    // The multi-advisory case the old first-placement fallback broke: a teacher
    // advising Grade 4 and Grade 5 must reach EITHER sheet, not always Grade 4's.
    const held = [placement(), GRADE_FIVE];
    expect(resolveAdvisoryGradeScope(held, "grade-g4")).toEqual({
      kind: "placement",
      placement: placement(),
    });
    expect(resolveAdvisoryGradeScope(held, "grade-g5")).toEqual({
      kind: "placement",
      placement: GRADE_FIVE,
    });
  });

  it("asks rather than guessing with two sections in one grade", () => {
    // THE regression. Both sections sit in Grade 4, so a grade id alone names two
    // sheets and picking the first would open a class nobody chose.
    const held = [placement(), SAME_GRADE_TWIN];
    const scope = resolveAdvisoryGradeScope(held, "grade-g4");
    expect(scope.kind).toBe("choose");
    expect(scope.kind === "choose" && scope.options).toEqual(held);
  });

  it("takes the section the URL names out of several in one grade", () => {
    const held = [placement(), SAME_GRADE_TWIN];
    expect(resolveAdvisoryGradeScope(held, "grade-g4", "section-ilang")).toEqual({
      kind: "placement",
      placement: SAME_GRADE_TWIN,
    });
  });

  it("re-asks for a section that is not theirs in this grade", () => {
    // Another teacher's section, or one in another school, must read the same as
    // one that does not exist: ask again, never confirm it by name.
    const held = [placement(), SAME_GRADE_TWIN];
    expect(resolveAdvisoryGradeScope(held, "grade-g4", "section-someone-else").kind).toBe(
      "choose"
    );
  });

  it("ignores a foreign section id when the grade holds exactly one advisory", () => {
    // One candidate, so there is nothing to choose between and nothing gained by
    // refusing — the page still renders that single advisory, never a wider one.
    expect(
      resolveAdvisoryGradeScope([placement()], "grade-g4", "section-someone-else")
    ).toEqual({ kind: "placement", placement: placement() });
  });

  it("sends a teacher who advises elsewhere to the chooser, not to a sheet", () => {
    const held = [placement(), GRADE_FIVE];
    const scope = resolveAdvisoryGradeScope(held, "grade-g9");
    expect(scope.kind).toBe("elsewhere");
    expect(scope.kind === "elsewhere" && scope.options).toEqual(held);
    // And never a placement — the old fallback returned `placements[0]` here.
    expect(scope.kind).not.toBe("placement");
  });

  it("reports none for a teacher who advises nothing at all", () => {
    expect(resolveAdvisoryGradeScope([], "grade-g9")).toEqual({ kind: "none" });
  });
});

describe("advisoryGradeLevelIds", () => {
  it("de-duplicates two sections that share a grade", () => {
    expect(
      advisoryGradeLevelIds([
        { gradeLevelId: "grade-g4" },
        { gradeLevelId: "grade-g4" },
        { gradeLevelId: "grade-g5" },
      ])
    ).toEqual(["grade-g4", "grade-g5"]);
  });

  it("keeps placement order and returns nothing for a floating teacher", () => {
    expect(advisoryGradeLevelIds([{ gradeLevelId: "b" }, { gradeLevelId: "a" }])).toEqual([
      "b",
      "a",
    ]);
    expect(advisoryGradeLevelIds([])).toEqual([]);
  });
});

describe("resolveAdvisoryTarget — exactly one advisory", () => {
  it("resolves without a section being named, exactly as before multi-advisory", () => {
    // The compatibility case, and the one every teacher is in immediately after
    // the backfill. Nothing about their experience changes.
    const target = resolveAdvisoryTarget([placement()]);

    expect(target).toEqual({ ok: true, placement: placement() });
  });

  it("resolves when that same section is named explicitly", () => {
    expect(
      resolveAdvisoryTarget([placement()], "section-sampaguita")
    ).toEqual({ ok: true, placement: placement() });
  });

  it("refuses a different section, generically", () => {
    const target = resolveAdvisoryTarget([placement()], "section-rosal");

    expect(target).toEqual({
      ok: false,
      reason: "not-yours",
      // Generic on purpose: another school's section, another teacher's, and
      // one that does not exist must all read the same.
      error: NOT_YOUR_ADVISORY_MESSAGE,
    });
  });
});

describe("resolveAdvisoryTarget — several advisories", () => {
  const both = [placement(), ROSAL];

  /** The regression this whole file exists for. */
  it("refuses to guess when no section is named", () => {
    const target = resolveAdvisoryTarget(both);

    expect(target.ok).toBe(false);
    expect(target).toMatchObject({ reason: "unspecified" });
  });

  it("names every section it holds, so the choice can be made", () => {
    const target = resolveAdvisoryTarget(both);

    if (target.ok) throw new Error("expected a refusal");
    expect(target.error).toContain("Grade 4 · Sampaguita");
    expect(target.error).toContain("Grade 4 · Rosal");
    expect(target.error).toContain("2 sections");
  });

  it("resolves the named one, and only the named one", () => {
    expect(resolveAdvisoryTarget(both, "section-rosal")).toEqual({
      ok: true,
      placement: ROSAL,
    });
    expect(resolveAdvisoryTarget(both, "section-sampaguita")).toEqual({
      ok: true,
      placement: placement(),
    });
  });

  it("refuses a section the teacher does not advise", () => {
    expect(resolveAdvisoryTarget(both, "section-ilang")).toMatchObject({
      reason: "not-yours",
    });
  });

  it("holds at the cap", () => {
    const three = [
      placement(),
      ROSAL,
      placement({ sectionId: "section-ilang", label: "Grade 4 · Ilang-Ilang" }),
    ];
    expect(three).toHaveLength(MAX_ADVISORY_SECTIONS);
    // Still a refusal rather than a guess, whatever the number.
    expect(resolveAdvisoryTarget(three)).toMatchObject({
      reason: "unspecified",
    });
  });
});
