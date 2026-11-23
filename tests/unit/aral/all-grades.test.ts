import { describe, expect, it } from "vitest";
import { commonHolidayKeys, gradeSectionLabel } from "@/lib/aral/all-grades";

describe("commonHolidayKeys", () => {
  it("keeps only days every grade on screen keeps as a holiday", () => {
    const byGrade = {
      g1: ["2026-11-02", "2026-11-03"],
      g2: ["2026-11-03"],
    };
    expect(commonHolidayKeys(byGrade, ["g1", "g2"])).toEqual(["2026-11-03"]);
  });

  it("locks nothing when one grade has no holiday that week", () => {
    expect(commonHolidayKeys({ g1: ["2026-11-03"] }, ["g1", "g2"])).toEqual([]);
  });

  it("locks nothing with no grades on screen", () => {
    expect(commonHolidayKeys({ g1: ["2026-11-03"] }, [])).toEqual([]);
  });

  it("counts a grade once however many learners it has", () => {
    expect(commonHolidayKeys({ g1: ["2026-11-03"] }, ["g1", "g1", "g1"])).toEqual([
      "2026-11-03",
    ]);
  });
});

describe("gradeSectionLabel", () => {
  it("names the grade, then the section", () => {
    expect(gradeSectionLabel("Grade 1", "A")).toBe("Grade 1 · A");
  });

  it("names only the grade when the learner has no section", () => {
    expect(gradeSectionLabel("Kinder", null)).toBe("Kinder");
  });
});
