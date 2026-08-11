import { describe, expect, it } from "vitest";
import {
  LEARNER_CSV_HEADERS,
  learnerCsvTemplate,
  mapCsvRowToImportCandidate,
  normalizeLearnerCsvHeader,
  parseBooleanLoose,
  parseDelimitedList,
  resolveEnumValue,
  resolveSectionIdByName,
  titleCaseName,
  validateImportRows,
  summarizeImportResults,
} from "@/lib/learners/import-csv";
import { learnerImportRowSchema } from "@/lib/validators/learner-import.schema";
import {
  READING_PROFILE_LABELS,
  READING_PROFILE_LABELS_K3,
  READING_PROFILE_LABELS_G4_PLUS,
} from "@/lib/constants/enum-labels";

describe("learnerCsvTemplate", () => {
  it("includes all Section A headers and an example row", () => {
    const csv = learnerCsvTemplate();
    const lines = csv.trim().split("\n");
    expect(lines[0]).toBe(LEARNER_CSV_HEADERS.join(","));
    expect(lines[1]).toContain("Ana");
    expect(LEARNER_CSV_HEADERS).toContain("isAralLearner");
    expect(LEARNER_CSV_HEADERS).toContain("parentEducation");
    expect(LEARNER_CSV_HEADERS).toContain("section");
    expect(LEARNER_CSV_HEADERS).toContain("modeOfTransportation");
    expect(LEARNER_CSV_HEADERS).toContain("distanceHomeToSchool");
    expect(LEARNER_CSV_HEADERS).toContain("previousTransfers");
    expect(LEARNER_CSV_HEADERS).toContain("transferDetails");
  });

  it("emits band labels in the example row when grade type is known", () => {
    const k3 = learnerCsvTemplate("G2");
    expect(k3).toContain(READING_PROFILE_LABELS_K3.INSTRUCTIONAL_DEVELOPING);
    expect(k3).toContain(READING_PROFILE_LABELS_K3.INDEPENDENT_GRADE_READY);

    const g4 = learnerCsvTemplate("G7");
    expect(g4).toContain(READING_PROFILE_LABELS_G4_PLUS.INSTRUCTIONAL_DEVELOPING);
    expect(g4).toContain(READING_PROFILE_LABELS_G4_PLUS.INDEPENDENT_GRADE_READY);
  });
});

describe("normalizeLearnerCsvHeader", () => {
  it("normalizes Section aliases", () => {
    expect(normalizeLearnerCsvHeader("Section")).toBe("section");
    expect(normalizeLearnerCsvHeader("section")).toBe("section");
    expect(normalizeLearnerCsvHeader(" firstName ")).toBe("firstName");
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
      section: "Rose",
      englishReadingProfile: "Instructional / Developing or Transitioning",
      englishFrustrationSubtypes: "",
      filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
      filipinoFrustrationSubtypes: "",
      governmentBenefits: "4Ps",
      parentEducation: "Secondary Graduate",
      modeOfTransportation: "Walking",
      distanceHomeToSchool: "Less than 1 km",
      previousTransfers: "No transfers",
      transferDetails: "",
      isAralLearner: "yes",
    });
    expect(mapped.firstName).toBe("Ana");
    expect(mapped.gender).toBe("FEMALE");
    expect(mapped.englishReadingProfile).toBe("INSTRUCTIONAL_DEVELOPING");
    expect(mapped.governmentBenefits).toEqual(["FOUR_PS"]);
    expect(mapped.parentEducation).toBe("SECONDARY_GRADUATE");
    expect(mapped.modeOfTransportation).toBe("WALKING");
    expect(mapped.distanceHomeToSchool).toBe("LESS_THAN_1KM");
    expect(mapped.previousTransfers).toBe("NONE");
    expect(mapped.isAralLearner).toBe(true);
    expect(mapped.sectionName).toBe("Rose");
  });

  it("accepts K3 and G4+ band reading profile labels", () => {
    const k3 = mapCsvRowToImportCandidate({
      firstName: "Ana",
      lastName: "Santos",
      age: "8",
      gender: "FEMALE",
      englishReadingProfile: READING_PROFILE_LABELS_K3.FRUSTRATION_HIGH_EMERGENT,
      filipinoReadingProfile: READING_PROFILE_LABELS_K3.NON_DECODER_LOW_EMERGENT,
      parentEducation: "SECONDARY_GRADUATE",
    });
    expect(k3.englishReadingProfile).toBe("FRUSTRATION_HIGH_EMERGENT");
    expect(k3.filipinoReadingProfile).toBe("NON_DECODER_LOW_EMERGENT");

    const g4 = mapCsvRowToImportCandidate({
      firstName: "Ben",
      lastName: "Cruz",
      age: "12",
      gender: "MALE",
      englishReadingProfile: READING_PROFILE_LABELS_G4_PLUS.INSTRUCTIONAL_DEVELOPING,
      filipinoReadingProfile: READING_PROFILE_LABELS_G4_PLUS.INDEPENDENT_GRADE_READY,
      parentEducation: "SECONDARY_GRADUATE",
    });
    expect(g4.englishReadingProfile).toBe("INSTRUCTIONAL_DEVELOPING");
    expect(g4.filipinoReadingProfile).toBe("INDEPENDENT_GRADE_READY");
  });

  it("reads Section header alias", () => {
    const mapped = mapCsvRowToImportCandidate({
      firstName: "Ana",
      lastName: "Santos",
      age: "10",
      Section: "Lily",
      gender: "FEMALE",
      englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
      filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
      parentEducation: "SECONDARY_GRADUATE",
    });
    expect(mapped.sectionName).toBe("Lily");
  });

  it("treats blank section as undefined", () => {
    const mapped = mapCsvRowToImportCandidate({
      firstName: "Ana",
      lastName: "Santos",
      age: "10",
      gender: "FEMALE",
      section: "  ",
      englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
      filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
      parentEducation: "SECONDARY_GRADUATE",
    });
    expect(mapped.sectionName).toBeUndefined();
  });
});

describe("resolveSectionIdByName", () => {
  const sections = [
    { id: "s1", name: "Rose" },
    { id: "s2", name: "Lily" },
  ];

  it("resolves case-insensitively and leaves blank null", () => {
    expect(resolveSectionIdByName("rose", sections).sectionId).toBe("s1");
    expect(resolveSectionIdByName("", sections).sectionId).toBeNull();
    expect(resolveSectionIdByName(undefined, sections).sectionId).toBeNull();
  });

  it("warns and returns null for unknown names", () => {
    const r = resolveSectionIdByName("Unknown", sections);
    expect(r.sectionId).toBeNull();
    expect(r.warning).toMatch(/not found/i);
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

  it("accepts optional sectionName and coerces empty to undefined", () => {
    const withName = learnerImportRowSchema.safeParse({
      ...valid,
      sectionName: "Rizal",
    });
    expect(withName.success).toBe(true);
    if (withName.success) expect(withName.data.sectionName).toBe("Rizal");

    const empty = learnerImportRowSchema.safeParse({
      ...valid,
      sectionName: "",
    });
    expect(empty.success).toBe(true);
    if (empty.success) expect(empty.data.sectionName).toBeUndefined();
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

  it("flags duplicates via existingKeys set", () => {
    const results = validateImportRows([goodRow], {
      existingKeys: new Set(["ana|santos|10"]),
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
