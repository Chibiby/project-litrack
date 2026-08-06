import { describe, expect, it } from "vitest";
import {
  schoolHeadProfileSchema,
  teacherProfileSchema,
} from "@/lib/validators/profile.schema";

const baseFields = {
  educationalAttainment: "BACHELORS" as const,
  fieldOfSpecialization: "ENGLISH" as const,
  yearsInService: "Y4_10" as const,
  hasReadingTraining: true,
  readingTrainings: ["ARAL", "ELLN"] as const,
  hasEnglishTraining: true,
  englishTrainings: ["MATATAG_TRAINING"] as const,
  highestTrainingLevel: "DIVISION" as const,
};

describe("schoolHeadProfileSchema", () => {
  it("accepts school-head positions and rejects teacher-only positions", () => {
    const ok = schoolHeadProfileSchema.safeParse({
      ...baseFields,
      position: "PRINCIPAL_I",
    });
    expect(ok.success).toBe(true);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...baseFields,
        position: "TEACHER_I",
      }).success,
    ).toBe(false);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...baseFields,
        position: "MASTER_TEACHER_I",
      }).success,
    ).toBe(false);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...baseFields,
        position: "HEAD_TEACHER_III",
      }).success,
    ).toBe(true);
  });

  it("accepts training arrays and requires specializationOther when Others", () => {
    const result = schoolHeadProfileSchema.safeParse({
      ...baseFields,
      position: "PRINCIPAL_II",
      fieldOfSpecialization: "OTHERS",
      specializationOther: "Guidance",
      readingTrainings: ["ARAL", "TEACHING_READING"],
      englishTrainings: ["UPSKILLING_ENGLISH_COMPETENCE"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.specializationOther).toBe("Guidance");
      expect(result.data.readingTrainings).toContain("ARAL");
    }

    expect(
      schoolHeadProfileSchema.safeParse({
        ...baseFields,
        position: "PRINCIPAL_I",
        fieldOfSpecialization: "OTHERS",
        specializationOther: undefined,
      }).success,
    ).toBe(false);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...baseFields,
        position: "PRINCIPAL_I",
        readingTrainings: ["NOT_A_TRAINING"],
      }).success,
    ).toBe(false);
  });

  it("enforces training Yes/No conditionals and None-at-all exclusivity", () => {
    expect(
      schoolHeadProfileSchema.safeParse({
        ...baseFields,
        position: "PRINCIPAL_I",
        hasReadingTraining: true,
        readingTrainings: [],
      }).success,
    ).toBe(false);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...baseFields,
        position: "PRINCIPAL_I",
        hasReadingTraining: false,
        readingTrainings: ["ARAL"],
      }).success,
    ).toBe(false);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...baseFields,
        position: "PRINCIPAL_I",
        hasReadingTraining: false,
        readingTrainings: [],
        hasEnglishTraining: false,
        englishTrainings: [],
      }).success,
    ).toBe(true);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...baseFields,
        position: "PRINCIPAL_I",
        readingTrainings: ["ARAL", "NONE"],
      }).success,
    ).toBe(false);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...baseFields,
        position: "PRINCIPAL_I",
        readingTrainings: ["NONE"],
        englishTrainings: ["NONE"],
      }).success,
    ).toBe(true);
  });
});

describe("teacherProfileSchema", () => {
  it("accepts teacher positions and rejects school-head positions", () => {
    const ok = teacherProfileSchema.safeParse({
      ...baseFields,
      position: "TEACHER_III",
      mostSubjectHandled: "ENGLISH",
      currentGradeAssignment: "G3",
    });
    expect(ok.success).toBe(true);

    expect(
      teacherProfileSchema.safeParse({
        ...baseFields,
        position: "PRINCIPAL_I",
        mostSubjectHandled: "MATH",
      }).success,
    ).toBe(false);

    expect(
      teacherProfileSchema.safeParse({
        ...baseFields,
        position: "HEAD_TEACHER_I",
        mostSubjectHandled: "MATH",
      }).success,
    ).toBe(false);
  });

  it("requires mostSubjectHandled and allows optional specializationOther", () => {
    expect(
      teacherProfileSchema.safeParse({
        ...baseFields,
        position: "MASTER_TEACHER_II",
      }).success,
    ).toBe(false);

    const withOther = teacherProfileSchema.safeParse({
      ...baseFields,
      position: "TEACHER_I",
      mostSubjectHandled: "FILIPINO",
      fieldOfSpecialization: "OTHERS",
      specializationOther: "SPED",
    });
    expect(withOther.success).toBe(true);
    if (withOther.success) {
      expect(withOther.data.specializationOther).toBe("SPED");
    }
  });

  it("accepts optional contactEmail (P-I4) and rejects invalid email", () => {
    const ok = teacherProfileSchema.safeParse({
      ...baseFields,
      position: "TEACHER_I",
      mostSubjectHandled: "ENGLISH",
      contactEmail: "teacher.contact@example.com",
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.contactEmail).toBe("teacher.contact@example.com");
    }

    const empty = teacherProfileSchema.safeParse({
      ...baseFields,
      position: "TEACHER_I",
      mostSubjectHandled: "ENGLISH",
      contactEmail: "  ",
    });
    expect(empty.success).toBe(true);
    if (empty.success) {
      expect(empty.data.contactEmail).toBeUndefined();
    }

    expect(
      teacherProfileSchema.safeParse({
        ...baseFields,
        position: "TEACHER_I",
        mostSubjectHandled: "ENGLISH",
        contactEmail: "not-an-email",
      }).success,
    ).toBe(false);

    const sh = schoolHeadProfileSchema.safeParse({
      ...baseFields,
      position: "PRINCIPAL_I",
      contactEmail: "sh.contact@deped.gov.ph",
    });
    expect(sh.success).toBe(true);
    if (sh.success) {
      expect(sh.data.contactEmail).toBe("sh.contact@deped.gov.ph");
    }
  });
});
