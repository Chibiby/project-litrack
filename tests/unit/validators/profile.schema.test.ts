import { describe, expect, it } from "vitest";
import {
  ARAL_VOLUNTEER_DESIGNATION,
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

/** Any valid section uuid — the schema only checks the shape, not existence. */
const SECTION_ID = "11111111-1111-4111-8111-111111111111";

/** School Head profiling now requires respondent names on the same payload. */
const shBase = {
  ...baseFields,
  firstName: "Maria",
  lastName: "Santos",
  designation: "School Head" as const,
};

/**
 * Teacher profiling requires respondent names (persisted on User), a grade
 * assignment, and — for every designation except the ARAL Volunteer — a section.
 */
const teacherBase = {
  ...baseFields,
  firstName: "Juan",
  lastName: "Dela Cruz",
  designation: "Teacher" as const,
  position: "TEACHER_III" as const,
  currentGradeAssignment: "G3" as const,
  sectionId: SECTION_ID,
};

/** ARAL Volunteers hold no ranked position and no classroom section. */
const aralVolunteerBase = {
  ...baseFields,
  firstName: "Ana",
  lastName: "Reyes",
  designation: ARAL_VOLUNTEER_DESIGNATION,
  currentGradeAssignment: "G3" as const,
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

  it("still requires a real yearsInService (teacher relaxation must not leak into baseProfile)", () => {
    // Regression guard: SchoolHeadProfile.yearsInService is Int NOT NULL, so the
    // teacher-only optional override must never reach the shared baseProfile.
    for (const yearsInService of [undefined, "", null]) {
      expect(
        schoolHeadProfileSchema.safeParse({
          ...shBase,
          position: "PRINCIPAL_I",
          yearsInService,
        }).success,
      ).toBe(false);
    }

    const { yearsInService: _omitted, ...withoutYears } = shBase;
    expect(
      schoolHeadProfileSchema.safeParse({
        ...withoutYears,
        position: "PRINCIPAL_I",
      }).success,
    ).toBe(false);
  });

  it("does not accept teacher-only fields", () => {
    const parsed = schoolHeadProfileSchema.safeParse({
      ...shBase,
      position: "PRINCIPAL_I",
      sectionId: SECTION_ID,
      currentGradeAssignment: "G3",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // Stripped, not persisted — School Heads have no advisory section.
      expect(parsed.data).not.toHaveProperty("sectionId");
      expect(parsed.data).not.toHaveProperty("currentGradeAssignment");
    }
  });
});

describe("teacherProfileSchema", () => {
  it("requires designation and rejects School Head", () => {
    expect(
      teacherProfileSchema.safeParse({ ...teacherBase, designation: undefined }).success,
    ).toBe(false);

    expect(
      teacherProfileSchema.safeParse({ ...teacherBase, designation: "" }).success,
    ).toBe(false);

    expect(
      teacherProfileSchema.safeParse({ ...teacherBase, designation: "School Head" })
        .success,
    ).toBe(false);

    expect(teacherProfileSchema.safeParse(teacherBase).success).toBe(true);
  });

  it("requires first and last name", () => {
    const { firstName: _f, lastName: _l, ...withoutNames } = teacherBase;
    expect(teacherProfileSchema.safeParse(withoutNames).success).toBe(false);

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
    expect(teacherProfileSchema.safeParse(teacherBase).success).toBe(true);

    expect(
      teacherProfileSchema.safeParse({
        ...teacherBase,
        position: "PRINCIPAL_I",
      }).success,
    ).toBe(false);

    expect(
      teacherProfileSchema.safeParse({
        ...teacherBase,
        position: "HEAD_TEACHER_I",
      }).success,
    ).toBe(false);
  });

  it("allows optional specializationOther and accepts NA specialization", () => {
    const withOther = teacherProfileSchema.safeParse({
      ...teacherBase,
      designation: "Teacher",
      position: "TEACHER_I",
      fieldOfSpecialization: "OTHERS",
      specializationOther: "SPED",
    });
    expect(withOther.success).toBe(true);
    if (withOther.success) {
      expect(withOther.data.specializationOther).toBe("SPED");
    }

    // "NA" mirrors the Specialization enum value added for ARAL Volunteers.
    const na = teacherProfileSchema.safeParse({
      ...teacherBase,
      fieldOfSpecialization: "NA",
    });
    expect(na.success).toBe(true);
    if (na.success) {
      expect(na.data.fieldOfSpecialization).toBe("NA");
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
      teacherProfileSchema.safeParse({ ...teacherBase, yearsInService: 3.5 }).success,
    ).toBe(false);
    expect(
      teacherProfileSchema.safeParse({ ...teacherBase, yearsInService: "abc" }).success,
    ).toBe(false);

    expect(
      schoolHeadProfileSchema.safeParse({
        ...shBase,
        position: "PRINCIPAL_I",
        yearsInService: "0",
      }).success,
    ).toBe(true);
  });

  it("treats blank/absent yearsInService as N/A for teachers", () => {
    for (const yearsInService of ["", null, undefined]) {
      const parsed = teacherProfileSchema.safeParse({ ...teacherBase, yearsInService });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.yearsInService).toBeUndefined();
    }

    const { yearsInService: _omitted, ...withoutYears } = teacherBase;
    const absent = teacherProfileSchema.safeParse(withoutYears);
    expect(absent.success).toBe(true);
    if (absent.success) expect(absent.data.yearsInService).toBeUndefined();
  });

  it("requires currentGradeAssignment for every designation except the ARAL Volunteer", () => {
    const { currentGradeAssignment: _g, ...teacherNoGrade } = teacherBase;
    const missing = teacherProfileSchema.safeParse(teacherNoGrade);
    expect(missing.success).toBe(false);
    if (!missing.success) {
      const issue = missing.error.errors.find(
        (e) => e.path[0] === "currentGradeAssignment",
      );
      expect(issue?.message).toBe("Select a grade level");
    }
    expect(
      teacherProfileSchema.safeParse({ ...teacherBase, currentGradeAssignment: undefined })
        .success,
    ).toBe(false);
    // Not a member of the enum, so this fails on the shape whatever the
    // designation is — the form sends `undefined` for "none", never "".
    expect(
      teacherProfileSchema.safeParse({ ...teacherBase, currentGradeAssignment: "" }).success,
    ).toBe(false);

    // Others free-text designation
    const { currentGradeAssignment: _g2, ...othersNoGrade } = teacherBase;
    expect(
      teacherProfileSchema.safeParse({
        ...othersNoGrade,
        designation: "Guidance Counselor",
        position: undefined,
      }).success,
    ).toBe(false);

    // The ARAL Volunteer holds no classroom assignment at all, so grade goes
    // optional alongside section — a volunteer can save with neither.
    const { currentGradeAssignment: _g3, ...volunteerNoGrade } = aralVolunteerBase;
    const volunteer = teacherProfileSchema.safeParse(volunteerNoGrade);
    expect(volunteer.success).toBe(true);
    if (volunteer.success) {
      expect(volunteer.data.currentGradeAssignment).toBeUndefined();
    }

    // ...and may still declare one if they happen to work with a single grade.
    expect(teacherProfileSchema.safeParse(aralVolunteerBase).success).toBe(true);
  });

  it("requires sectionId for every designation except the ARAL Volunteer", () => {
    const { sectionId: _s, ...teacherNoSection } = teacherBase;

    const missing = teacherProfileSchema.safeParse(teacherNoSection);
    expect(missing.success).toBe(false);
    if (!missing.success) {
      const issue = missing.error.errors.find((e) => e.path[0] === "sectionId");
      expect(issue?.message).toBe("Select a section");
    }

    for (const sectionId of ["", null, undefined]) {
      expect(
        teacherProfileSchema.safeParse({ ...teacherBase, sectionId }).success,
      ).toBe(false);
    }

    expect(
      teacherProfileSchema.safeParse({
        ...teacherNoSection,
        designation: "Master Teacher",
        position: "MASTER_TEACHER_II",
      }).success,
    ).toBe(false);

    expect(
      teacherProfileSchema.safeParse({
        ...teacherNoSection,
        designation: "Guidance Counselor",
        position: undefined,
      }).success,
    ).toBe(false);

    // A non-uuid section id is rejected outright, whatever the designation.
    expect(
      teacherProfileSchema.safeParse({ ...teacherBase, sectionId: "not-a-uuid" }).success,
    ).toBe(false);
    expect(
      teacherProfileSchema.safeParse({
        ...aralVolunteerBase,
        sectionId: "not-a-uuid",
      }).success,
    ).toBe(false);
  });

  it("accepts the ARAL Volunteer designation with no position and an optional section", () => {
    const noSection = teacherProfileSchema.safeParse(aralVolunteerBase);
    expect(noSection.success).toBe(true);
    if (noSection.success) {
      expect(noSection.data.designation).toBe(ARAL_VOLUNTEER_DESIGNATION);
      expect(noSection.data.position).toBeUndefined();
      expect(noSection.data.sectionId).toBeUndefined();
    }

    for (const sectionId of ["", null]) {
      const blank = teacherProfileSchema.safeParse({ ...aralVolunteerBase, sectionId });
      expect(blank.success).toBe(true);
      if (blank.success) expect(blank.data.sectionId).toBeUndefined();
    }

    const withSection = teacherProfileSchema.safeParse({
      ...aralVolunteerBase,
      sectionId: SECTION_ID,
    });
    expect(withSection.success).toBe(true);
    if (withSection.success) {
      expect(withSection.data.sectionId).toBe(SECTION_ID);
    }

    // Ranked positions stay forbidden for the volunteer designation.
    expect(
      teacherProfileSchema.safeParse({
        ...aralVolunteerBase,
        position: "TEACHER_I",
      }).success,
    ).toBe(false);

    // N/A specialization + N/A years in service is the volunteer's default shape.
    const naDefaults = teacherProfileSchema.safeParse({
      ...aralVolunteerBase,
      fieldOfSpecialization: "NA",
      yearsInService: "",
      highestTrainingLevel: "NA",
    });
    expect(naDefaults.success).toBe(true);
    if (naDefaults.success) {
      expect(naDefaults.data.yearsInService).toBeUndefined();
      expect(naDefaults.data.fieldOfSpecialization).toBe("NA");
    }
  });
});
