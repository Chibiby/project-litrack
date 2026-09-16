import { describe, it, expect } from "vitest";
import { resolveMixedAdvisoryDefault } from "@/components/terms/default-advisory";
import { splitByKinderGradeType } from "@/lib/terms/kinder-checklist-view";

/**
 * Owner bug: `resolveAdvisoryTarget` returns "unspecified" for two or more
 * non-Kinder advisories, so a mixed teacher with 1 Kinder + 2 numeric
 * advisories landed with `advisory` still null — the combined numeric view
 * rendered, but the hero dropdown hides "All advisories" for a mixed
 * teacher, leaving a blank trigger. `resolveMixedAdvisoryDefault` always
 * picks the first non-Kinder advisory instead of asking, so the sheet and
 * the dropdown selection can never disagree.
 */

interface Placement {
  sectionId: string;
  gradeType: string;
  label: string;
}

const KINDER: Placement = { sectionId: "kinder-1", gradeType: "KINDER", label: "Kinder - Barbie" };
const GRADE_1: Placement = { sectionId: "g1-a", gradeType: "G1", label: "Grade 1 - Amber" };
const GRADE_2: Placement = { sectionId: "g2-b", gradeType: "G2", label: "Grade 2 - Bronze" };

describe("resolveMixedAdvisoryDefault", () => {
  it("1 Kinder + 1 numeric: defaults to that numeric section (today's behavior, unchanged)", () => {
    const { numeric } = splitByKinderGradeType([KINDER, GRADE_1]);
    expect(resolveMixedAdvisoryDefault(numeric)?.sectionId).toBe("g1-a");
  });

  it("1 Kinder + 2 numeric: defaults to the first numeric section by dropdown order", () => {
    const { numeric } = splitByKinderGradeType([KINDER, GRADE_1, GRADE_2]);
    expect(resolveMixedAdvisoryDefault(numeric)?.sectionId).toBe("g1-a");
  });

  it("1 Kinder + 2 numeric, dropdown order reversed: still follows that order, not a fixed section", () => {
    const { numeric } = splitByKinderGradeType([KINDER, GRADE_2, GRADE_1]);
    expect(resolveMixedAdvisoryDefault(numeric)?.sectionId).toBe("g2-b");
  });

  it("no Kindergarten advisory: nothing to default (page keeps combined 'All advisories')", () => {
    const { kinder, numeric } = splitByKinderGradeType([GRADE_1, GRADE_2]);
    expect(kinder.length).toBe(0);
    // The page only calls resolveMixedAdvisoryDefault when kinder.length > 0;
    // documented here so a caller cannot mistake this for "pick one anyway".
    expect(numeric.map((p) => p.sectionId)).toEqual(["g1-a", "g2-b"]);
  });

  it("returns null for an empty numeric list (Kinder-only teacher never reaches this page)", () => {
    expect(resolveMixedAdvisoryDefault([])).toBeNull();
  });
});

describe("mixed-teacher default, composed the way page.tsx wires it", () => {
  /**
   * Mirrors `terms-reports/page.tsx`'s decision without a database: an
   * explicit `?advisory=` still wins and a Kinder id still means "go to the
   * Kinder route" (unchanged by this fix); only the no-`?advisory=` default
   * for a mixed teacher goes through `resolveMixedAdvisoryDefault`.
   */
  function resolveScope(
    placements: readonly Placement[],
    requestedSectionId: string | null
  ): { advisory: Placement | null; redirectToKinder: boolean } {
    const { kinder, numeric } = splitByKinderGradeType(placements);
    const requested = placements.find((p) => p.sectionId === requestedSectionId) ?? null;
    if (requested && kinder.includes(requested)) {
      return { advisory: null, redirectToKinder: true };
    }
    let advisory = requested;
    if (!advisory && kinder.length > 0) {
      advisory = resolveMixedAdvisoryDefault(numeric);
    }
    return { advisory, redirectToKinder: false };
  }

  it("1 Kinder + 1 numeric, no ?advisory=: opens that numeric section", () => {
    expect(resolveScope([KINDER, GRADE_1], null)).toEqual({
      advisory: GRADE_1,
      redirectToKinder: false,
    });
  });

  it("1 Kinder + 2 numeric, no ?advisory=: opens the first numeric section, never blank", () => {
    const result = resolveScope([KINDER, GRADE_1, GRADE_2], null);
    expect(result.advisory).not.toBeNull();
    expect(result).toEqual({ advisory: GRADE_1, redirectToKinder: false });
  });

  it("no Kindergarten advisory: untouched, advisory stays null (All advisories)", () => {
    expect(resolveScope([GRADE_1, GRADE_2], null)).toEqual({
      advisory: null,
      redirectToKinder: false,
    });
  });

  it("explicit ?advisory= still wins, even with two numeric advisories in scope", () => {
    expect(resolveScope([KINDER, GRADE_1, GRADE_2], "g2-b")).toEqual({
      advisory: GRADE_2,
      redirectToKinder: false,
    });
  });

  it("explicit ?advisory= for the Kinder section still redirects to the Kinder route", () => {
    expect(resolveScope([KINDER, GRADE_1, GRADE_2], "kinder-1")).toEqual({
      advisory: null,
      redirectToKinder: true,
    });
  });
});
