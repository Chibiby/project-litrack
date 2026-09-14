import { describe, expect, it } from "vitest";
import {
  languagesForGrade,
  allowedReadingValuesForGrade,
  isReadingValueAllowedForGrade,
  readingProfileOptionsForGrade,
  isReadingRecordComplete,
  completeAssessmentWhereForGrades,
  EARLY_RUBRIC_VALUES,
  SHS_ALLOWED_VALUES,
  STANDARD_VALUES,
} from "@/lib/reading/policy";
import { labelReadingProfile } from "@/lib/constants/enum-labels";

/**
 * Regression coverage for the shared reading-policy module
 * (docs/reading-policy-spec.md sections 2-4). Each case here is chosen to fail
 * if the underlying feature were reverted: wrong language scope per grade,
 * wrong allowed-value set, a stale label, or a completeness/where-shape that
 * silently falls back to the pre-policy behaviour.
 */

describe("languagesForGrade", () => {
  it("Kinder collects both languages", () => {
    expect(languagesForGrade("KINDER")).toEqual(["ENGLISH", "FILIPINO"]);
  });

  it("Grade 1 and Grade 2 are Filipino only", () => {
    expect(languagesForGrade("G1")).toEqual(["FILIPINO"]);
    expect(languagesForGrade("G2")).toEqual(["FILIPINO"]);
  });

  it("Grade 3, Grade 5, Grade 10, Grade 11 and Grade 12 all keep both languages", () => {
    for (const gradeType of ["G3", "G5", "G10", "G11", "G12"]) {
      expect(languagesForGrade(gradeType), gradeType).toEqual(["ENGLISH", "FILIPINO"]);
    }
  });
});

describe("allowedReadingValuesForGrade", () => {
  it("pins the Kinder rubric set to exactly the four new members, in rubric order", () => {
    const expected = [
      "CANNOT_NAME_SOUND_LETTERS",
      "LETTER_LEVEL",
      "CV_BLENDING",
      "CVC_BLENDING",
    ];
    expect(EARLY_RUBRIC_VALUES).toEqual(expected);
    expect(allowedReadingValuesForGrade("KINDER")).toEqual(expected);
  });

  it("gives Grade 1 and Grade 2 the same levels and labels as Grade 3", () => {
    for (const gradeType of ["G1", "G2"]) {
      expect(allowedReadingValuesForGrade(gradeType), gradeType).toEqual(
        allowedReadingValuesForGrade("G3")
      );
      expect(readingProfileOptionsForGrade(gradeType), gradeType).toEqual(
        readingProfileOptionsForGrade("G3")
      );
      expect(isReadingValueAllowedForGrade("CV_BLENDING", gradeType), gradeType).toBe(false);
    }
  });

  it("pins the SHS set to exactly three original members, excluding NON_DECODER_LOW_EMERGENT", () => {
    const expected = [
      "FRUSTRATION_HIGH_EMERGENT",
      "INSTRUCTIONAL_DEVELOPING",
      "INDEPENDENT_GRADE_READY",
    ];
    expect(SHS_ALLOWED_VALUES).toEqual(expected);
    expect(allowedReadingValuesForGrade("G11")).toEqual(expected);
    expect(allowedReadingValuesForGrade("G12")).toEqual(expected);
    expect(allowedReadingValuesForGrade("G11")).not.toContain("NON_DECODER_LOW_EMERGENT");
    expect(isReadingValueAllowedForGrade("NON_DECODER_LOW_EMERGENT", "G11")).toBe(false);
  });

  it("pins G3-G10 (and FLOATING) to exactly the original four, unrestricted", () => {
    const expected = [
      "NON_DECODER_LOW_EMERGENT",
      "FRUSTRATION_HIGH_EMERGENT",
      "INSTRUCTIONAL_DEVELOPING",
      "INDEPENDENT_GRADE_READY",
    ];
    expect(STANDARD_VALUES).toEqual(expected);
    for (const gradeType of ["G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "FLOATING"]) {
      expect(allowedReadingValuesForGrade(gradeType), gradeType).toEqual(expected);
    }
  });
});

describe("readingProfileOptionsForGrade — exact labels", () => {
  it("K/1/2 rubric labels", () => {
    expect(readingProfileOptionsForGrade("KINDER")).toEqual([
      { value: "CANNOT_NAME_SOUND_LETTERS", label: "Level 0 - Cannot name and sound letters" },
      { value: "LETTER_LEVEL", label: "Level 1 - Letter Level" },
      { value: "CV_BLENDING", label: "Level 2 - CV blending" },
      { value: "CVC_BLENDING", label: "Level 3 - CVC blending" },
    ]);
  });

  it("SHS labels", () => {
    expect(readingProfileOptionsForGrade("G11")).toEqual([
      { value: "FRUSTRATION_HIGH_EMERGENT", label: "Frustration Level" },
      { value: "INSTRUCTIONAL_DEVELOPING", label: "Instructional Level" },
      { value: "INDEPENDENT_GRADE_READY", label: "Independent Level" },
    ]);
  });

  it("Grade 5 labels are pinned to the current PHIL-IRI-style set, unchanged by this spec", () => {
    expect(readingProfileOptionsForGrade("G5")).toEqual([
      { value: "NON_DECODER_LOW_EMERGENT", label: "Non-decoder" },
      { value: "FRUSTRATION_HIGH_EMERGENT", label: "Frustration" },
      { value: "INSTRUCTIONAL_DEVELOPING", label: "Instructional" },
      { value: "INDEPENDENT_GRADE_READY", label: "Independent" },
    ]);
  });
});

describe("isReadingRecordComplete", () => {
  const base = {
    englishProfile: null as string | null,
    filipinoProfile: "INDEPENDENT_GRADE_READY",
    wordRecognitionLevel: "LEVEL_5",
    readingComprehensionLevel: "LEVEL_3",
  };

  it("Grade 1 with Filipino + word + comprehension and no English is complete", () => {
    expect(isReadingRecordComplete(base, "G1")).toBe(true);
  });

  it("the equivalent Grade 5 record with the same three fields and no English is NOT complete", () => {
    expect(isReadingRecordComplete(base, "G5")).toBe(false);
  });
});

describe("completeAssessmentWhereForGrades", () => {
  it("builds an OR of a Filipino-only shape and a both-language shape for a mixed Kinder + Grade 1 set", () => {
    // Kinder collects both languages; Grade 1 is Filipino-only — mixing the two
    // in one set is exactly what forces the OR, unlike a Kinder+G5 set (both
    // require both languages) or an all-G1/G2 set (both are Filipino-only).
    const where = completeAssessmentWhereForGrades([
      { id: "grade-kinder", type: "KINDER" },
      { id: "grade-g1", type: "G1" },
    ]);
    expect(where).toHaveProperty("OR");
    const shapes = (where as { OR: Record<string, unknown>[] }).OR;
    expect(shapes).toHaveLength(2);
    const filipinoOnly = shapes.find((s) => !("englishProfile" in s));
    const both = shapes.find((s) => "englishProfile" in s);
    expect(filipinoOnly).toBeDefined();
    expect(both).toBeDefined();
  });

  it("collapses an all-Grade-5 set to a single AND shape, no OR", () => {
    const where = completeAssessmentWhereForGrades([
      { id: "grade-g5-a", type: "G5" },
      { id: "grade-g5-b", type: "G5" },
    ]);
    expect(where).not.toHaveProperty("OR");
    expect(where).toHaveProperty("englishProfile", { not: null });
    expect(where).toHaveProperty("filipinoProfile", { not: null });
  });
});

describe("labelReadingProfile — value-first dispatch (decision I)", () => {
  it("a rubric value keeps its rubric label even under a Grade 5 (promoted) context", () => {
    // Legacy rows carry no grade snapshot; a K/1/2 rubric value must render its
    // rubric label regardless of the learner's CURRENT grade — never relabeled
    // as though it were a G4+ PHIL-IRI band just because the learner was later
    // promoted (docs/reading-policy-spec.md section 2, decision I).
    expect(labelReadingProfile("CVC_BLENDING", "G5")).toBe("Level 3 - CVC blending");
    expect(labelReadingProfile("LETTER_LEVEL", "G11")).toBe("Level 1 - Letter Level");
  });

  it("an original-four value still dispatches by the current grade, unchanged", () => {
    expect(labelReadingProfile("INDEPENDENT_GRADE_READY", "G5")).toBe("Independent");
    expect(labelReadingProfile("INDEPENDENT_GRADE_READY", "G2")).toBe("Grade-level Ready");
    expect(labelReadingProfile("INDEPENDENT_GRADE_READY", "G11")).toBe("Independent Level");
  });
});
