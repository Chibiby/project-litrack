import { describe, expect, it } from "vitest";
import { aralProfileSchema } from "@/lib/validators/aral.schema";

const validFull = {
  learnerId: "learner-1",
  modeOfTransportation: "WALKING" as const,
  distanceHomeToSchool: "LESS_THAN_1KM" as const,
  previousTransfers: "NONE" as const,
  transferDetails: undefined,
  absenteeismFrequency: "ONE_TO_THREE_PER_MONTH" as const,
  absenteeismOtherReason: "Illness",
  letterRecognition: "ALL_EASY" as const,
  letterSoundCorrespondence: "ACCURATE" as const,
  wordRecognition: "READS_HF_FLUENT" as const,
  homeLiteracyEnvironment: "HAS_ACCESS" as const,
  parentalSupport: "REGULAR" as const,
  classroomEnvironment: "SMALL_CLASS" as const,
  languageConsiderations: ["MATCHES_LOI"] as const,
  suggestedInterventions: ["PHONEMIC_AWARENESS", "HOME_READING"] as const,
  lsenObservations: undefined,
  furtherAssessment: ["MFAT"] as const,
  furtherAssessmentOther: undefined,
};

describe("aralProfileSchema", () => {
  it("accepts a valid full payload", () => {
    const result = aralProfileSchema.safeParse(validFull);
    expect(result.success).toBe(true);
  });

  it("rejects invalid values for each required enum", () => {
    const cases: Array<{ field: string; value: string }> = [
      { field: "modeOfTransportation", value: "BIKE" },
      { field: "distanceHomeToSchool", value: "TEN_KM" },
      { field: "previousTransfers", value: "MANY" },
      { field: "absenteeismFrequency", value: "DAILY" },
      { field: "letterRecognition", value: "UNKNOWN" },
      { field: "letterSoundCorrespondence", value: "SOMETIMES" },
      { field: "wordRecognition", value: "FLUENT" },
      { field: "homeLiteracyEnvironment", value: "RICH" },
      { field: "parentalSupport", value: "HIGH" },
      { field: "classroomEnvironment", value: "MEDIUM_CLASS" },
    ];

    for (const { field, value } of cases) {
      const result = aralProfileSchema.safeParse({ ...validFull, [field]: value });
      expect(result.success, `${field} should reject ${value}`).toBe(false);
    }

    expect(
      aralProfileSchema.safeParse({
        ...validFull,
        languageConsiderations: ["UNKNOWN_LANG"],
      }).success,
    ).toBe(false);

    expect(
      aralProfileSchema.safeParse({
        ...validFull,
        suggestedInterventions: ["UNKNOWN_INTERVENTION"],
      }).success,
    ).toBe(false);

    expect(
      aralProfileSchema.safeParse({
        ...validFull,
        furtherAssessment: ["UNKNOWN_ASSESS"],
      }).success,
    ).toBe(false);
  });

  it("enforces optional text max lengths", () => {
    const over500 = "x".repeat(501);
    const over1000 = "y".repeat(1001);

    expect(
      aralProfileSchema.safeParse({
        ...validFull,
        previousTransfers: "MULTIPLE",
        transferDetails: over500,
      }).success,
    ).toBe(false);
    expect(
      aralProfileSchema.safeParse({ ...validFull, absenteeismOtherReason: over500 }).success,
    ).toBe(false);
    expect(
      aralProfileSchema.safeParse({
        ...validFull,
        furtherAssessment: ["OTHER"],
        furtherAssessmentOther: over500,
      }).success,
    ).toBe(false);
    expect(
      aralProfileSchema.safeParse({
        ...validFull,
        suggestedInterventions: ["LSEN_OTHER"],
        lsenObservations: over1000,
      }).success,
    ).toBe(false);

    expect(
      aralProfileSchema.safeParse({
        ...validFull,
        previousTransfers: "MULTIPLE",
        transferDetails: "x".repeat(500),
      }).success,
    ).toBe(true);
    expect(
      aralProfileSchema.safeParse({
        ...validFull,
        suggestedInterventions: ["LSEN_OTHER"],
        lsenObservations: "y".repeat(1000),
      }).success,
    ).toBe(true);
  });

  it("requires Specify texts for Multiple transfers, LSEN, and Further Assessment Other", () => {
    expect(
      aralProfileSchema.safeParse({
        ...validFull,
        previousTransfers: "MULTIPLE",
        transferDetails: undefined,
      }).success,
    ).toBe(false);

    expect(
      aralProfileSchema.safeParse({
        ...validFull,
        previousTransfers: "MULTIPLE",
        transferDetails: "Three schools in two years",
      }).success,
    ).toBe(true);

    expect(
      aralProfileSchema.safeParse({
        ...validFull,
        suggestedInterventions: ["LSEN_OTHER"],
        lsenObservations: undefined,
      }).success,
    ).toBe(false);

    expect(
      aralProfileSchema.safeParse({
        ...validFull,
        furtherAssessment: ["OTHER"],
        furtherAssessmentOther: undefined,
      }).success,
    ).toBe(false);

    expect(
      aralProfileSchema.safeParse({
        ...validFull,
        absenteeismOtherReason: undefined,
      }).success,
    ).toBe(false);
  });
});
