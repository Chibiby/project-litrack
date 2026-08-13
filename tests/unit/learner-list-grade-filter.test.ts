import { describe, expect, it } from "vitest";
import {
  gradeLevelIdWhere,
  parseLearnerListParams,
} from "@/lib/learners/pagination";

const G1 = "grade-1-id";
const G2 = "grade-2-id";
const FLOATING_ID = "floating-grade-id";

describe("parseLearnerListParams — grade filter", () => {
  it("defaults to all grades", () => {
    expect(parseLearnerListParams({}).grade).toBe("all");
    expect(parseLearnerListParams({ grade: "" }).grade).toBe("all");
    expect(parseLearnerListParams({ grade: "   " }).grade).toBe("all");
    expect(parseLearnerListParams({ grade: "all" }).grade).toBe("all");
  });

  it("recognises the floating sentinel case-insensitively", () => {
    expect(parseLearnerListParams({ grade: "floating" }).grade).toBe("floating");
    expect(parseLearnerListParams({ grade: "FLOATING" }).grade).toBe("floating");
    expect(parseLearnerListParams({ grade: " Floating " }).grade).toBe("floating");
  });

  it("passes a grade id through unchanged (ids are case-sensitive)", () => {
    expect(parseLearnerListParams({ grade: G1 }).grade).toBe(G1);
  });
});

describe("gradeLevelIdWhere", () => {
  it("selects the FLOATING grade by relation, still intersected with assigned ids", () => {
    // The FLOATING grade id is per-school and unknown here, so the clause matches
    // by type — but it must stay intersected so it can never widen visibility.
    expect(gradeLevelIdWhere("floating", [G1, FLOATING_ID])).toEqual({
      gradeLevelId: { in: [G1, FLOATING_ID] },
      gradeLevel: { type: "FLOATING" },
    });
  });

  it("never widens past the assigned grades, even when the list is empty", () => {
    const where = gradeLevelIdWhere("floating", []);
    expect(where).toEqual({
      gradeLevelId: { in: [] },
      gradeLevel: { type: "FLOATING" },
    });
  });

  it("narrows to a single assigned grade", () => {
    expect(gradeLevelIdWhere(G2, [G1, G2])).toEqual({ gradeLevelId: G2 });
  });

  it("falls back to all assigned grades for an unknown id", () => {
    // A grade id the teacher does not hold must not become a usable filter.
    expect(gradeLevelIdWhere("someone-elses-grade", [G1, G2])).toEqual({
      gradeLevelId: { in: [G1, G2] },
    });
  });

  it("returns all assigned grades for 'all'", () => {
    expect(gradeLevelIdWhere("all", [G1, G2])).toEqual({
      gradeLevelId: { in: [G1, G2] },
    });
  });
});
