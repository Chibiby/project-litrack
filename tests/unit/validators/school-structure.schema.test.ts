import { describe, expect, it } from "vitest";
import {
  CREATABLE_GRADE_LEVEL_TYPES,
  createGradeLevelSchema,
  PROFILING_GRADE_LEVEL_TYPES,
  schoolStructureSchema,
} from "@/lib/validators/grade-level.schema";

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

  it("accepts KINDER (school head profiling covers Kinder + G1–G12)", () => {
    expect(
      schoolStructureSchema.safeParse({
        gradeTypes: ["KINDER"],
        sectionsPerGrade: 1,
      }).success
    ).toBe(true);
    expect(
      schoolStructureSchema.safeParse({
        gradeTypes: ["KINDER", "G1", "G2"],
        sectionsPerGrade: 2,
      }).success
    ).toBe(true);
  });

  it("rejects FLOATING (system-managed, created on demand)", () => {
    expect(
      schoolStructureSchema.safeParse({
        gradeTypes: ["FLOATING"],
        sectionsPerGrade: 1,
      }).success
    ).toBe(false);
    // Also rejected when mixed in with valid grades.
    expect(
      schoolStructureSchema.safeParse({
        gradeTypes: ["G1", "FLOATING"],
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

describe("PROFILING_GRADE_LEVEL_TYPES", () => {
  it("covers Kinder through G12 with Kinder first (render order)", () => {
    expect(PROFILING_GRADE_LEVEL_TYPES[0]).toBe("KINDER");
    expect(PROFILING_GRADE_LEVEL_TYPES).toHaveLength(13); // Kinder + G1–G12
    expect(PROFILING_GRADE_LEVEL_TYPES.at(-1)).toBe("G12");
  });

  it("excludes FLOATING — it is created on demand, never picked", () => {
    expect(PROFILING_GRADE_LEVEL_TYPES).not.toContain("FLOATING");
  });
});

describe("createGradeLevelSchema", () => {
  it("accepts KINDER", () => {
    expect(createGradeLevelSchema.safeParse({ type: "KINDER" }).success).toBe(true);
  });

  it("accepts every creatable type", () => {
    for (const type of CREATABLE_GRADE_LEVEL_TYPES) {
      expect(createGradeLevelSchema.safeParse({ type }).success).toBe(true);
    }
  });

  it("rejects FLOATING — system-managed via ensureFloatingGradeLevel", () => {
    expect(createGradeLevelSchema.safeParse({ type: "FLOATING" }).success).toBe(false);
  });

  it("rejects an unknown type", () => {
    expect(createGradeLevelSchema.safeParse({ type: "GRADE_1" }).success).toBe(false);
  });
});
