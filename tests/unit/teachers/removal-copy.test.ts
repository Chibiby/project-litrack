import { describe, expect, it } from "vitest";
import { removalAdvisoryNote } from "@/lib/teachers/removal-copy";

describe("removalAdvisoryNote", () => {
  it("names each section that will become Unassigned and the learners left without an adviser", () => {
    expect(
      removalAdvisoryNote({
        assignments: [
          { gradeName: "Grade 3", sectionName: "Sampaguita" },
          { gradeName: "Grade 4", sectionName: "Rosal" },
        ],
        learnerCount: 31,
      })
    ).toBe(
      "Grade 3 · Sampaguita, Grade 4 · Rosal will become Unassigned. 31 learner(s) will have no adviser until you assign one to their section."
    );
  });

  it("mentions only the sections when none of them hold learners", () => {
    expect(
      removalAdvisoryNote({
        assignments: [{ gradeName: "Grade 1", sectionName: "Mabini" }],
        learnerCount: 0,
      })
    ).toBe("Grade 1 · Mabini will become Unassigned.");
  });

  it("says nothing for a teacher who advises nobody", () => {
    expect(removalAdvisoryNote({ assignments: [], learnerCount: 0 })).toBeNull();
  });
});
