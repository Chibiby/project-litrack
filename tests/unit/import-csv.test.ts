import { describe, expect, it } from "vitest";
import {
  LEARNER_CSV_HEADERS,
  learnerCsvTemplate,
  mapCsvRowToImportCandidate,
  parseBooleanLoose,
  parseDelimitedList,
  resolveEnumValue,
  titleCaseName,
  validateImportRows,
  summarizeImportResults,
} from "@/lib/learners/import-csv";
import { learnerImportRowSchema } from "@/lib/validators/learner-import.schema";
import { READING_PROFILE_LABELS } from "@/lib/constants/enum-labels";

describe("learnerCsvTemplate", () => {
  it("includes all Section A headers and an example row", () => {
    const csv = learnerCsvTemplate();
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(LEARNER_CSV_HEADERS.join(","));
    expect(lines[1]).toContain("Ana");
    expect(LEARNER_CSV_HEADERS).toContain("isAralLearner");
    expect(LEARNER_CSV_HEADERS).toContain("parentEducation");
  });
});

describe("parse helpers", () => {
  it("parses delimited lists", () => {
    expect(parseDelimitedList("FOUR_PS;IPS")).toEqual(["FOUR_PS", "IPS"]);
    expect(parseDelimitedList("DECODING|COMPREHENSION_ALL")).toEqual([
      "DECODING",
      "COMPREHENSION_ALL",
    ]);
    expect(parseDelimitedList("")).toEqual([]);
    expect(parseDelimitedList(null)).toEqual([]);
  });

  it("parses loose booleans", () => {
    expect(parseBooleanLoose("yes")).toBe(true);
    expect(parseBooleanLoose("TRUE")).toBe(true);
    expect(parseBooleanLoose("1")).toBe(true);
    expect(parseBooleanLoose("no")).toBe(false);
    expect(parseBooleanLoose("")).toBe(false);
    expect(parseBooleanLoose(undefined)).toBe(false);
  });

  it("resolves enum labels and codes", () => {
    const lookup = new Map<string, string>();
    for (const [code, label] of Object.entries(READING_PROFILE_LABELS)) {
      lookup.set(code.toLowerCase(), code);
      lookup.set(label.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " "), code);
    }
    expect(resolveEnumValue("INSTRUCTIONAL_DEVELOPING", lookup)).toBe(
      "INSTRUCTIONAL_DEVELOPING"
    );
  });

  it("title-cases names after normalize", () => {
    expect(titleCaseName("  ANA   marie ")).toBe("Ana Marie");
  });
});

describe("mapCsvRowToImportCandidate", () => {
  it("maps codes and label aliases", () => {
    const mapped = mapCsvRowToImportCandidate({
      firstName: " Ana ",
      middleName: "",
      lastName: "Santos",
      age: "10",
      gender: "Female",
      englishReadingProfile: "Instructional / Developing or Transitioning",
      englishFrustrationSubtypes: "",
      filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
      filipinoFrustrationSubtypes: "",
      governmentBenefits: "4Ps",
      parentEducation: "Secondary Graduate",
      isAralLearner: "yes",
    });
    expect(mapped.firstName).toBe("Ana");
    expect(mapped.gender).toBe("FEMALE");
    expect(mapped.englishReadingProfile).toBe("INSTRUCTIONAL_DEVELOPING");
    expect(mapped.governmentBenefits).toEqual(["FOUR_PS"]);
    expect(mapped.parentEducation).toBe("SECONDARY_GRADUATE");
    expect(mapped.isAralLearner).toBe(true);
  });
});

describe("learnerImportRowSchema", () => {
  const valid = {
    firstName: "Ana",
    lastName: "Santos",
    age: 10,
    gender: "FEMALE" as const,
    englishReadingProfile: "INSTRUCTIONAL_DEVELOPING" as const,
    filipinoReadingProfile: "INDEPENDENT_GRADE_READY" as const,
    parentEducation: "SECONDARY_GRADUATE" as const,
  };

  it("accepts valid Section A rows", () => {
    const r = learnerImportRowSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("rejects frustration subtypes without Frustration profile", () => {
    const r = learnerImportRowSchema.safeParse({
      ...valid,
      englishFrustrationSubtypes: ["DECODING"],
    });
    expect(r.success).toBe(false);
  });
});

describe("validateImportRows", () => {
  const goodRow = {
    firstName: "Ana",
    lastName: "Santos",
    age: "10",
    gender: "FEMALE",
    englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
    englishFrustrationSubtypes: "",
    filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
    filipinoFrustrationSubtypes: "",
    governmentBenefits: "",
    parentEducation: "SECONDARY_GRADUATE",
    isAralLearner: "false",
  };

  it("returns valid + invalid results with row numbers", () => {
    const results = validateImportRows([
      goodRow,
      { ...goodRow, firstName: "", lastName: "X", age: "9" },
    ]);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.rowNumber).toBe(2);
    expect(results[1]?.ok).toBe(false);
    if (!results[1]?.ok) {
      expect(results[1].errors.length).toBeGreaterThan(0);
    }
    expect(summarizeImportResults(results)).toEqual({
      valid: 1,
      invalid: 1,
      duplicateWarnings: 0,
    });
  });

  it("flags duplicates against existing school learners", () => {
    const results = validateImportRows([goodRow], {
      existing: [{ firstName: "Ana", lastName: "Santos", age: 10 }],
    });
    expect(results[0]?.ok).toBe(true);
    if (results[0]?.ok) {
      expect(results[0].duplicateWarning).toBe(true);
    }
  });

  it("flags within-file duplicates", () => {
    const results = validateImportRows([goodRow, { ...goodRow }]);
    expect(results.filter((r) => r.ok && r.duplicateWarning).length).toBeGreaterThanOrEqual(1);
  });
});
