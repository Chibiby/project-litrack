import { describe, expect, it } from "vitest";
import {
  masterlistSources,
  nextGradeType,
  previousGradeType,
  targetGradeType,
} from "@/lib/learners/masterlist-grades";

describe("grade arithmetic", () => {
  it("steps one grade up and down", () => {
    expect(nextGradeType("KINDER")).toBe("G1");
    expect(nextGradeType("G4")).toBe("G5");
    expect(previousGradeType("G5")).toBe("G4");
    expect(previousGradeType("G1")).toBe("KINDER");
  });

  it("has no grade after Grade 12 or before Kinder", () => {
    expect(nextGradeType("G12")).toBeNull();
    expect(previousGradeType("KINDER")).toBeNull();
  });

  it("treats FLOATING and unknown values as no grade", () => {
    expect(nextGradeType("FLOATING")).toBeNull();
    expect(previousGradeType("FLOATING")).toBeNull();
    expect(nextGradeType("nope")).toBeNull();
  });
});

describe("targetGradeType", () => {
  it("moves a promoted learner one grade up", () => {
    expect(targetGradeType("G4", "PROMOTED")).toBe("G5");
    expect(targetGradeType("KINDER", "PROMOTED")).toBe("G1");
  });

  it("keeps a retained learner in the same grade", () => {
    expect(targetGradeType("G4", "RETAINED")).toBe("G4");
    expect(targetGradeType("G12", "RETAINED")).toBe("G12");
  });

  it("gives a promoted Grade 12 learner nowhere to go", () => {
    expect(targetGradeType("G12", "PROMOTED")).toBeNull();
  });

  it("gives FLOATING nowhere to go", () => {
    expect(targetGradeType("FLOATING", "RETAINED")).toBeNull();
    expect(targetGradeType("FLOATING", "PROMOTED")).toBeNull();
  });
});

describe("masterlistSources", () => {
  it("reads the grade below's promoted and this grade's retained", () => {
    expect(masterlistSources("G5")).toEqual([
      { gradeType: "G4", outcome: "PROMOTED" },
      { gradeType: "G5", outcome: "RETAINED" },
    ]);
  });

  it("reads Kinder promoted for Grade 1", () => {
    expect(masterlistSources("G1")).toEqual([
      { gradeType: "KINDER", outcome: "PROMOTED" },
      { gradeType: "G1", outcome: "RETAINED" },
    ]);
  });

  it("reads only retained Kinder learners for a Kinder advisory", () => {
    expect(masterlistSources("KINDER")).toEqual([{ gradeType: "KINDER", outcome: "RETAINED" }]);
  });

  it("reads nothing for a non-grade", () => {
    expect(masterlistSources("FLOATING")).toEqual([]);
  });

  it("agrees with targetGradeType for every source", () => {
    for (const target of ["KINDER", "G1", "G6", "G12"]) {
      for (const s of masterlistSources(target)) {
        expect(targetGradeType(s.gradeType, s.outcome)).toBe(target);
      }
    }
  });
});
