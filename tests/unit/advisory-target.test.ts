import { describe, expect, it } from "vitest";
import {
  resolveAdvisoryPlacementForGrade,
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

describe("resolveAdvisoryPlacementForGrade", () => {
  it("selects the placement named by a grade-scoped report URL", () => {
    const gradeFive = placement({
      gradeLevelId: "grade-g5",
      gradeType: "G5",
      gradeLabel: "Grade 5",
      label: "Grade 5 · Rosal",
    });

    expect(resolveAdvisoryPlacementForGrade([placement(), gradeFive], "grade-g5")).toBe(
      gradeFive
    );
  });

  it("keeps the first-placement fallback for an invalid or stale URL", () => {
    const placements = [placement(), ROSAL];
    expect(resolveAdvisoryPlacementForGrade(placements, "grade-g9")).toBe(
      placements[0]
    );
    expect(resolveAdvisoryPlacementForGrade([], "grade-g9")).toBeNull();
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
