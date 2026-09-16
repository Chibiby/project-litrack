import { describe, expect, it } from "vitest";
import {
  computeProfileCompletion,
  profileCompletionMessage,
  type ProfileCompletionInput,
} from "@/lib/teachers/profile-completion";

const COMPLETE: ProfileCompletionInput = {
  firstName: "Juan",
  middleName: "Santos",
  lastName: "Dela Cruz",
  contactNumber: "09171234567",
  gender: "MALE",
  ethnicity: "ILOCANO",
  educationalAttainment: "BACHELORS",
  fieldOfSpecialization: "ENGLISH",
  yearsInService: 4,
  hasReadingTraining: true,
  readingTrainings: ["ARAL"],
  hasEnglishTraining: false,
  englishTrainings: [],
  highestTrainingLevel: "DIVISION",
};

describe("computeProfileCompletion", () => {
  it("is 0% for an empty profile", () => {
    const result = computeProfileCompletion({});
    expect(result.percent).toBe(0);
    expect(result.filled).toBe(0);
    expect(result.total).toBeGreaterThan(0);
  });

  it("is 100% when every counted field is filled", () => {
    expect(computeProfileCompletion(COMPLETE)).toEqual({ percent: 100, filled: 13, total: 13 });
  });

  it("counts a partial profile and rounds down", () => {
    const result = computeProfileCompletion({
      ...COMPLETE,
      middleName: "",
      contactNumber: "   ",
      gender: null,
    });
    expect(result.filled).toBe(10);
    expect(result.total).toBe(13);
    expect(result.percent).toBe(76);
  });

  it("never reads 100% while one counted field is missing", () => {
    const result = computeProfileCompletion({ ...COMPLETE, highestTrainingLevel: "" });
    expect(result.percent).toBeLessThan(100);
  });

  it("does not lower the score for conditional fields that do not apply", () => {
    // No Others, no specify lines; English answered No, so no English list.
    expect(computeProfileCompletion(COMPLETE).percent).toBe(100);
    // Years in service saved as N/A is an answer, not a gap.
    expect(computeProfileCompletion({ ...COMPLETE, yearsInService: null }).percent).toBe(100);
  });

  it("counts a conditional field once it applies", () => {
    const other = computeProfileCompletion({ ...COMPLETE, ethnicity: "OTHER", ethnicityOther: "" });
    expect(other.total).toBe(14);
    expect(other.percent).toBeLessThan(100);
    expect(
      computeProfileCompletion({ ...COMPLETE, ethnicity: "OTHER", ethnicityOther: "Tausug" }).percent
    ).toBe(100);

    const spec = computeProfileCompletion({ ...COMPLETE, fieldOfSpecialization: "OTHERS" });
    expect(spec.percent).toBeLessThan(100);

    const english = computeProfileCompletion({ ...COMPLETE, hasEnglishTraining: true, englishTrainings: [] });
    expect(english.percent).toBeLessThan(100);
  });

  it("counts years in service as missing when it was never answered", () => {
    expect(computeProfileCompletion({ ...COMPLETE, yearsInService: undefined }).percent).toBeLessThan(100);
  });
});

describe("profileCompletionMessage", () => {
  it("says All set! only at 100%", () => {
    expect(profileCompletionMessage(100)).toBe("All set!");
    expect(profileCompletionMessage(99)).not.toBe("All set!");
  });

  it("encourages by band", () => {
    expect(profileCompletionMessage(85)).toBe("Keep going! You're almost there.");
    expect(profileCompletionMessage(50)).not.toBe(profileCompletionMessage(85));
    expect(profileCompletionMessage(0)).not.toBe(profileCompletionMessage(50));
  });
});
