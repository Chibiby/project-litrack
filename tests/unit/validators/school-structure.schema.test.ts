import { describe, expect, it } from "vitest";
import { schoolStructureSchema } from "@/lib/validators/grade-level.schema";

describe("schoolStructureSchema", () => {
  it("accepts valid grade types and sections per grade", () => {
    const ok = schoolStructureSchema.safeParse({
      gradeTypes: ["G1", "G2"],
      sectionsPerGrade: 3,
    });
    expect(ok.success).toBe(true);
  });

  it("requires at least one grade type", () => {
    const bad = schoolStructureSchema.safeParse({
      gradeTypes: [],
      sectionsPerGrade: 1,
    });
    expect(bad.success).toBe(false);
  });

  it("rejects invalid grade types", () => {
    const bad = schoolStructureSchema.safeParse({
      gradeTypes: ["GRADE_1"],
      sectionsPerGrade: 1,
    });
    expect(bad.success).toBe(false);
  });

  it("rejects KINDER and FLOATING (profiling is G1–G12 only)", () => {
    expect(
      schoolStructureSchema.safeParse({
        gradeTypes: ["KINDER"],
        sectionsPerGrade: 1,
      }).success
    ).toBe(false);
    expect(
      schoolStructureSchema.safeParse({
        gradeTypes: ["FLOATING"],
        sectionsPerGrade: 1,
      }).success
    ).toBe(false);
  });

  it("coerces sectionsPerGrade and enforces 1–26", () => {
    expect(
      schoolStructureSchema.safeParse({
        gradeTypes: ["G1"],
        sectionsPerGrade: "2",
      }).success
    ).toBe(true);
    expect(
      schoolStructureSchema.safeParse({
        gradeTypes: ["G1"],
        sectionsPerGrade: 0,
      }).success
    ).toBe(false);
    expect(
      schoolStructureSchema.safeParse({
        gradeTypes: ["G1"],
        sectionsPerGrade: 27,
      }).success
    ).toBe(false);
  });
});
