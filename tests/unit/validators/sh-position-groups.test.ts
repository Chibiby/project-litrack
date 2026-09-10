import { describe, expect, it } from "vitest";
import {
  SH_OTHER_POSITIONS,
  SH_PRINCIPAL_POSITIONS,
  schoolHeadProfileSchema,
} from "@/lib/validators/profile.schema";
import { SCHOOL_HEAD_POSITION_LABELS } from "@/lib/constants/enum-labels";

const shBase = {
  firstName: "Maria",
  lastName: "Santos",
  designation: "School Head" as const,
  educationalAttainment: "BACHELORS" as const,
  fieldOfSpecialization: "ENGLISH" as const,
  yearsInService: 4,
  hasReadingTraining: false,
  readingTrainings: [],
  hasEnglishTraining: false,
  englishTrainings: [],
  highestTrainingLevel: "DIVISION" as const,
};

describe("School Head position groups", () => {
  it("offers the four Principal ranks first", () => {
    expect([...SH_PRINCIPAL_POSITIONS]).toEqual([
      "PRINCIPAL_I",
      "PRINCIPAL_II",
      "PRINCIPAL_III",
      "PRINCIPAL_IV",
    ]);
  });

  // The two groups are a presentation split of one enum. If a rank were dropped
  // from both, the picker would silently stop offering a position the schema
  // still accepts — and a head who holds it could never record it.
  it("covers every position the schema accepts, with no overlap", () => {
    const grouped = [...SH_PRINCIPAL_POSITIONS, ...SH_OTHER_POSITIONS];
    const accepted = Object.keys(SCHOOL_HEAD_POSITION_LABELS);

    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual([...accepted].sort());
  });

  it("keeps the Principal ranks out of the second group", () => {
    for (const principal of SH_PRINCIPAL_POSITIONS) {
      expect(SH_OTHER_POSITIONS).not.toContain(principal);
    }
  });

  it("has a label for every option, so no raw enum value can render", () => {
    for (const position of [...SH_PRINCIPAL_POSITIONS, ...SH_OTHER_POSITIONS]) {
      expect(SCHOOL_HEAD_POSITION_LABELS[position]).toBeTruthy();
    }
  });

  // A Head Teacher or Teacher-in-Charge leading a small school is the reason the
  // second group exists; the schema has to accept what the picker offers.
  it.each([...SH_PRINCIPAL_POSITIONS, ...SH_OTHER_POSITIONS])(
    "accepts %s on a school head profile",
    (position) => {
      expect(schoolHeadProfileSchema.safeParse({ ...shBase, position }).success).toBe(true);
    }
  );

  it("still rejects a position that is not a school head rank", () => {
    expect(
      schoolHeadProfileSchema.safeParse({ ...shBase, position: "MASTER_TEACHER_I" }).success
    ).toBe(false);
    expect(schoolHeadProfileSchema.safeParse({ ...shBase, position: "" }).success).toBe(false);
  });
});

describe("School Head contact email", () => {
  it("accepts and lower-cases a contact address", () => {
    const parsed = schoolHeadProfileSchema.safeParse({
      ...shBase,
      position: "PRINCIPAL_I",
      contactEmail: "  Head@School.DepEd.Gov.PH  ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.contactEmail).toBe("head@school.deped.gov.ph");
  });

  // Optional in both directions: heads profiled before the field returned to the
  // UI have none, and a head may decline to give a personal address.
  it.each([
    ["omitted", undefined],
    ["blank", ""],
    ["whitespace", "   "],
    ["null", null],
  ])("treats a %s address as absent rather than invalid", (_name, contactEmail) => {
    const parsed = schoolHeadProfileSchema.safeParse({
      ...shBase,
      position: "PRINCIPAL_I",
      contactEmail,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.contactEmail).toBeUndefined();
  });

  it("rejects a malformed address instead of storing it", () => {
    const parsed = schoolHeadProfileSchema.safeParse({
      ...shBase,
      position: "PRINCIPAL_I",
      contactEmail: "not-an-email",
    });
    expect(parsed.success).toBe(false);
  });
});
