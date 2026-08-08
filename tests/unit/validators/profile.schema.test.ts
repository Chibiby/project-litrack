import { describe, expect, it } from "vitest";
import {
  schoolHeadProfileSchema,
  teacherProfileSchema,
} from "@/lib/validators/profile.schema";

const baseFields = {
  educationalAttainment: "BACHELORS" as const,
  fieldOfSpecialization: "ENGLISH" as const,
  yearsInService: 4,
  hasReadingTraining: true,
  readingTrainings: ["ARAL", "ELLN"] as const,
  hasEnglishTraining: true,
  englishTrainings: ["MATATAG_TRAINING"] as const,
  highestTrainingLevel: "DIVISION" as const,
};

/** School Head profiling now requires respondent names on the same payload. */
const shBase = {
  ...baseFields,
  firstName: "Maria",
  lastName: "Santos",
  designation: "School Head" as const,
};

/** Teacher profiling requires respondent names (persisted on User). */
const teacherBase = {
  ...baseFields,
  firstName: "Juan",
  lastName: "Dela Cruz",
  designation: "Teacher" as const,
  position: "TEACHER_III" as const,
  mostSubjectHandled: "ENGLISH" as const,
};

describe("schoolHeadProfileSchema", () => {
  it("requires designation School Head and accepts SH positions", () => {
    const ok = schoolHeadProfileSchema.safeParse({
      ...shBase,
      position: "PRINCIPAL_I",
    });
    expect(ok.success).toBe(true);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...shBase,
        designation: undefined,
        position: "PRINCIPAL_I",
      }).success,
    ).toBe(false);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...baseFields,
        firstName: "Maria",
        lastName: "Santos",
        designation: "Teacher",
        position: "PRINCIPAL_I",
      }).success,
    ).toBe(false);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...shBase,
        position: "TEACHER_I",
      }).success,
    ).toBe(false);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...shBase,
        position: "MASTER_TEACHER_I",
      }).success,
    ).toBe(false);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...shBase,
        position: "HEAD_TEACHER_III",
      }).success,
    ).toBe(true);
  });

  it("requires first and last name", () => {
    expect(
      schoolHeadProfileSchema.safeParse({
        ...baseFields,
        designation: "School Head",
        position: "PRINCIPAL_I",
      }).success,
    ).toBe(false);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...shBase,
        firstName: "",
        position: "PRINCIPAL_I",
      }).success,
    ).toBe(false);
  });

  it("accepts training arrays and requires specializationOther when Others", () => {
    const result = schoolHeadProfileSchema.safeParse({
      ...shBase,
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
        ...shBase,
        position: "PRINCIPAL_I",
        fieldOfSpecialization: "OTHERS",
        specializationOther: undefined,
      }).success,
    ).toBe(false);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...shBase,
        position: "PRINCIPAL_I",
        readingTrainings: ["NOT_A_TRAINING"],
      }).success,
    ).toBe(false);
  });

  it("enforces training Yes/No conditionals and None-at-all exclusivity", () => {
    expect(
      schoolHeadProfileSchema.safeParse({
        ...shBase,
        position: "PRINCIPAL_I",
        hasReadingTraining: true,
        readingTrainings: [],
      }).success,
    ).toBe(false);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...shBase,
        position: "PRINCIPAL_I",
        hasReadingTraining: false,
        readingTrainings: ["ARAL"],
      }).success,
    ).toBe(false);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...shBase,
        position: "PRINCIPAL_I",
        hasReadingTraining: false,
        readingTrainings: [],
        hasEnglishTraining: false,
        englishTrainings: [],
      }).success,
    ).toBe(true);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...shBase,
        position: "PRINCIPAL_I",
        readingTrainings: ["ARAL", "NONE"],
      }).success,
    ).toBe(false);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...shBase,
        position: "PRINCIPAL_I",
        readingTrainings: ["NONE"],
        englishTrainings: ["NONE"],
      }).success,
    ).toBe(true);
  });
});

describe("teacherProfileSchema", () => {
  it("requires designation and rejects School Head", () => {
    expect(
      teacherProfileSchema.safeParse({
        ...baseFields,
        firstName: "Juan",
        lastName: "Dela Cruz",
        position: "TEACHER_III",
        mostSubjectHandled: "ENGLISH",
      }).success,
    ).toBe(false);

    expect(
      teacherProfileSchema.safeParse({
        ...baseFields,
        firstName: "Juan",
        lastName: "Dela Cruz",
        designation: "",
        position: "TEACHER_III",
        mostSubjectHandled: "ENGLISH",
      }).success,
    ).toBe(false);

    expect(
      teacherProfileSchema.safeParse({
        ...baseFields,
        firstName: "Juan",
        lastName: "Dela Cruz",
        designation: "School Head",
        position: "TEACHER_III",
        mostSubjectHandled: "ENGLISH",
      }).success,
    ).toBe(false);

    expect(teacherProfileSchema.safeParse(teacherBase).success).toBe(true);
  });

  it("requires first and last name", () => {
    expect(
      teacherProfileSchema.safeParse({
        ...baseFields,
        designation: "Teacher",
        position: "TEACHER_III",
        mostSubjectHandled: "ENGLISH",
      }).success,
    ).toBe(false);

    expect(
      teacherProfileSchema.safeParse({
        ...teacherBase,
        firstName: "",
      }).success,
    ).toBe(false);

    expect(
      teacherProfileSchema.safeParse({
        ...teacherBase,
        middleName: "Reyes",
      }).success,
    ).toBe(true);
  });

  it("requires Teacher I–VII when designation is Teacher", () => {
    expect(
      teacherProfileSchema.safeParse({
        ...teacherBase,
        designation: "Teacher",
        position: "TEACHER_III",
      }).success,
    ).toBe(true);

    expect(
      teacherProfileSchema.safeParse({
        ...teacherBase,
        designation: "Teacher",
        position: undefined,
      }).success,
    ).toBe(false);

    expect(
      teacherProfileSchema.safeParse({
        ...teacherBase,
        designation: "Teacher",
        position: "MASTER_TEACHER_I",
      }).success,
    ).toBe(false);

    expect(
      teacherProfileSchema.safeParse({
        ...teacherBase,
        designation: "Teacher",
        position: "PRINCIPAL_I",
      }).success,
    ).toBe(false);
  });

  it("requires Master Teacher I–IV when designation is Master Teacher", () => {
    expect(
      teacherProfileSchema.safeParse({
        ...teacherBase,
        designation: "Master Teacher",
        position: "MASTER_TEACHER_II",
      }).success,
    ).toBe(true);

    expect(
      teacherProfileSchema.safeParse({
        ...teacherBase,
        designation: "Master Teacher",
        position: undefined,
      }).success,
    ).toBe(false);

    expect(
      teacherProfileSchema.safeParse({
        ...teacherBase,
        designation: "Master Teacher",
        position: "TEACHER_I",
      }).success,
    ).toBe(false);
  });

  it("accepts custom Others designation without position and rejects when position set", () => {
    const ok = teacherProfileSchema.safeParse({
      ...teacherBase,
      designation: "Guidance Counselor",
      position: undefined,
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.position).toBeUndefined();
    }

    expect(
      teacherProfileSchema.safeParse({
        ...teacherBase,
        designation: "Guidance Counselor",
        position: null,
      }).success,
    ).toBe(true);

    expect(
      teacherProfileSchema.safeParse({
        ...teacherBase,
        designation: "Guidance Counselor",
        position: "TEACHER_I",
      }).success,
    ).toBe(false);
  });

  it("accepts teacher positions and rejects school-head positions", () => {
    const ok = teacherProfileSchema.safeParse({
      ...teacherBase,
      currentGradeAssignment: "G3",
    });
    expect(ok.success).toBe(true);

    expect(
      teacherProfileSchema.safeParse({
        ...teacherBase,
        position: "PRINCIPAL_I",
        mostSubjectHandled: "MATH",
      }).success,
    ).toBe(false);

    expect(
      teacherProfileSchema.safeParse({
        ...teacherBase,
        position: "HEAD_TEACHER_I",
        mostSubjectHandled: "MATH",
      }).success,
    ).toBe(false);
  });

  it("requires mostSubjectHandled and allows optional specializationOther", () => {
    expect(
      teacherProfileSchema.safeParse({
        ...baseFields,
        firstName: "Juan",
        lastName: "Dela Cruz",
        designation: "Master Teacher",
        position: "MASTER_TEACHER_II",
      }).success,
    ).toBe(false);

    const withOther = teacherProfileSchema.safeParse({
      ...teacherBase,
      designation: "Teacher",
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

  it("still accepts optional legacy contactEmail and rejects invalid email", () => {
    const ok = teacherProfileSchema.safeParse({
      ...teacherBase,
      contactEmail: "teacher.contact@example.com",
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.contactEmail).toBe("teacher.contact@example.com");
    }

    const empty = teacherProfileSchema.safeParse({
      ...teacherBase,
      contactEmail: "  ",
    });
    expect(empty.success).toBe(true);
    if (empty.success) {
      expect(empty.data.contactEmail).toBeUndefined();
    }

    expect(
      teacherProfileSchema.safeParse({
        ...teacherBase,
        contactEmail: "not-an-email",
      }).success,
    ).toBe(false);

    // Omitted contactEmail is valid (UI no longer collects it)
    expect(teacherProfileSchema.safeParse(teacherBase).success).toBe(true);

    const sh = schoolHeadProfileSchema.safeParse({
      ...shBase,
      position: "PRINCIPAL_I",
      contactEmail: "sh.contact@deped.gov.ph",
    });
    expect(sh.success).toBe(true);
    if (sh.success) {
      expect(sh.data.contactEmail).toBe("sh.contact@deped.gov.ph");
    }
  });

  it("accepts yearsInService 0–70 (coerces FormData strings) and rejects out of range", () => {
    expect(
      teacherProfileSchema.safeParse({ ...teacherBase, yearsInService: 0 }).success,
    ).toBe(true);
    expect(
      teacherProfileSchema.safeParse({ ...teacherBase, yearsInService: 70 }).success,
    ).toBe(true);
    const coerced = teacherProfileSchema.safeParse({
      ...teacherBase,
      yearsInService: "12",
    });
    expect(coerced.success).toBe(true);
    if (coerced.success) expect(coerced.data.yearsInService).toBe(12);

    expect(
      teacherProfileSchema.safeParse({ ...teacherBase, yearsInService: -1 }).success,
    ).toBe(false);
    expect(
      teacherProfileSchema.safeParse({ ...teacherBase, yearsInService: 71 }).success,
    ).toBe(false);
    expect(
      teacherProfileSchema.safeParse({ ...teacherBase, yearsInService: "" }).success,
    ).toBe(false);
    expect(
      teacherProfileSchema.safeParse({ ...teacherBase, yearsInService: 3.5 }).success,
    ).toBe(false);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...shBase,
        position: "PRINCIPAL_I",
        yearsInService: "0",
      }).success,
    ).toBe(true);
  });
});
