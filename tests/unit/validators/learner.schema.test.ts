import { describe, expect, it } from "vitest";
import {
  learnerCreateSchema,
  learnerUpdateSchema,
  learnerIdSchema,
} from "@/lib/validators/learner.schema";
import {
  transferLearnerSchema,
  transferLearnerCrossSchoolSchema,
  SECTION_CLEAR,
  GRADE_FLOATING,
} from "@/lib/validators/enrollment.schema";

const SECTION_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const validBase = {
  gradeLevelId: "gl-1",
  firstName: "Ana",
  lastName: "Santos",
  age: 10,
  gender: "FEMALE" as const,
  englishReadingProfile: "INSTRUCTIONAL_DEVELOPING" as const,
  filipinoReadingProfile: "INDEPENDENT_GRADE_READY" as const,
  parentEducation: "SECONDARY_GRADUATE" as const,
};

describe("learnerCreateSchema", () => {
  it("accepts a valid payload and applies array/boolean defaults", () => {
    const result = learnerCreateSchema.safeParse(validBase);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.englishFrustrationSubtypes).toEqual([]);
    expect(result.data.filipinoFrustrationSubtypes).toEqual([]);
    expect(result.data.governmentBenefits).toEqual([]);
    expect(result.data.modeOfTransportation).toBeUndefined();
    expect(result.data.confirmDuplicate).toBe(false);
    expect("isAralLearner" in result.data).toBe(false);
  });

  it("accepts optional Section B fields and requires transferDetails for MULTIPLE", () => {
    const withB = learnerCreateSchema.safeParse({
      ...validBase,
      modeOfTransportation: "WALKING",
      distanceHomeToSchool: "LESS_THAN_1KM",
      previousTransfers: "NONE",
    });
    expect(withB.success).toBe(true);

    expect(
      learnerCreateSchema.safeParse({
        ...validBase,
        previousTransfers: "MULTIPLE",
      }).success
    ).toBe(false);

    const multi = learnerCreateSchema.safeParse({
      ...validBase,
      previousTransfers: "MULTIPLE",
      transferDetails: "Three schools",
    });
    expect(multi.success).toBe(true);
  });

  it("parses confirmDuplicate from form string values", () => {
    expect(
      learnerCreateSchema.safeParse({ ...validBase, confirmDuplicate: "true" })
        .success
    ).toBe(true);
    const confirmed = learnerCreateSchema.safeParse({
      ...validBase,
      confirmDuplicate: "true",
    });
    expect(confirmed.success && confirmed.data.confirmDuplicate).toBe(true);

    const onVal = learnerCreateSchema.safeParse({
      ...validBase,
      confirmDuplicate: "on",
    });
    expect(onVal.success && onVal.data.confirmDuplicate).toBe(true);

    const falseVal = learnerCreateSchema.safeParse({
      ...validBase,
      confirmDuplicate: "false",
    });
    expect(falseVal.success && falseVal.data.confirmDuplicate).toBe(false);
  });

  it("enforces age bounds 3–25", () => {
    expect(learnerCreateSchema.safeParse({ ...validBase, age: 2 }).success).toBe(
      false
    );
    expect(learnerCreateSchema.safeParse({ ...validBase, age: 3 }).success).toBe(
      true
    );
    expect(learnerCreateSchema.safeParse({ ...validBase, age: 25 }).success).toBe(
      true
    );
    expect(learnerCreateSchema.safeParse({ ...validBase, age: 26 }).success).toBe(
      false
    );
  });

  it("rejects invalid gender", () => {
    expect(
      learnerCreateSchema.safeParse({ ...validBase, gender: "OTHER" }).success
    ).toBe(false);
    expect(
      learnerCreateSchema.safeParse({ ...validBase, gender: "MALE" }).success
    ).toBe(true);
  });

  it("treats empty/null sectionId as undefined and accepts uuid", () => {
    const empty = learnerCreateSchema.safeParse({
      ...validBase,
      sectionId: "",
    });
    expect(empty.success).toBe(true);
    if (empty.success) expect(empty.data.sectionId).toBeUndefined();

    const whitespace = learnerCreateSchema.safeParse({
      ...validBase,
      sectionId: "   ",
    });
    expect(whitespace.success).toBe(true);
    if (whitespace.success) expect(whitespace.data.sectionId).toBeUndefined();

    const nulled = learnerCreateSchema.safeParse({
      ...validBase,
      sectionId: null,
    });
    expect(nulled.success).toBe(true);
    if (nulled.success) expect(nulled.data.sectionId).toBeUndefined();

    const withId = learnerCreateSchema.safeParse({
      ...validBase,
      sectionId: SECTION_UUID,
    });
    expect(withId.success).toBe(true);
    if (withId.success) expect(withId.data.sectionId).toBe(SECTION_UUID);

    expect(
      learnerCreateSchema.safeParse({
        ...validBase,
        sectionId: "not-a-uuid",
      }).success
    ).toBe(false);
  });

  it("accepts frustration subtypes only when Frustration/High Emergent is selected", () => {
    const withSubtypes = learnerCreateSchema.safeParse({
      ...validBase,
      englishReadingProfile: "FRUSTRATION_HIGH_EMERGENT",
      filipinoReadingProfile: "FRUSTRATION_HIGH_EMERGENT",
      englishFrustrationSubtypes: ["DECODING", "COMPREHENSION_ALL"],
      filipinoFrustrationSubtypes: ["COMPREHENSION_CRITICAL"],
    });
    expect(withSubtypes.success).toBe(true);
    if (withSubtypes.success) {
      expect(withSubtypes.data.englishFrustrationSubtypes).toEqual([
        "DECODING",
        "COMPREHENSION_ALL",
      ]);
      expect(withSubtypes.data.filipinoFrustrationSubtypes).toEqual([
        "COMPREHENSION_CRITICAL",
      ]);
    }

    expect(
      learnerCreateSchema.safeParse({
        ...validBase,
        englishFrustrationSubtypes: ["DECODING"],
      }).success
    ).toBe(false);

    expect(
      learnerCreateSchema.safeParse({
        ...validBase,
        englishFrustrationSubtypes: ["NOT_A_SUBTYPE"],
      }).success
    ).toBe(false);
  });

  it("accepts governmentBenefits multi-select (FOUR_PS, IPS)", () => {
    const both = learnerCreateSchema.safeParse({
      ...validBase,
      governmentBenefits: ["FOUR_PS", "IPS"],
    });
    expect(both.success).toBe(true);
    if (both.success) {
      expect(both.data.governmentBenefits).toEqual(["FOUR_PS", "IPS"]);
    }

    expect(
      learnerCreateSchema.safeParse({
        ...validBase,
        governmentBenefits: ["SCHOLARSHIP"],
      }).success
    ).toBe(false);
  });

  it("enforces parentEducation enum", () => {
    for (const parentEducation of [
      "NO_FORMAL",
      "ELEMENTARY_LEVEL",
      "ELEMENTARY_GRADUATE",
      "SECONDARY_LEVEL",
      "SECONDARY_GRADUATE",
      "COLLEGE_LEVEL",
      "COLLEGE_GRADUATE",
    ] as const) {
      expect(
        learnerCreateSchema.safeParse({ ...validBase, parentEducation }).success
      ).toBe(true);
    }
    expect(
      learnerCreateSchema.safeParse({ ...validBase, parentEducation: "PHD" })
        .success
    ).toBe(false);
  });

  it("accepts optional sectionId uuid or empty→undefined", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const withSection = learnerCreateSchema.safeParse({
      ...validBase,
      sectionId: uuid,
    });
    expect(withSection.success).toBe(true);
    if (withSection.success) {
      expect(withSection.data.sectionId).toBe(uuid);
    }

    const empty = learnerCreateSchema.safeParse({ ...validBase, sectionId: "" });
    expect(empty.success).toBe(true);
    if (empty.success) {
      expect(empty.data.sectionId).toBeUndefined();
    }

    expect(
      learnerCreateSchema.safeParse({ ...validBase, sectionId: "not-a-uuid" }).success
    ).toBe(false);
  });
});

describe("learnerUpdateSchema", () => {
  const updateBase = {
    id: "learner-1",
    firstName: "Ana",
    lastName: "Santos",
    age: 10,
    gender: "FEMALE" as const,
    englishReadingProfile: "INSTRUCTIONAL_DEVELOPING" as const,
    filipinoReadingProfile: "INDEPENDENT_GRADE_READY" as const,
    parentEducation: "SECONDARY_GRADUATE" as const,
  };

  it("requires id and Section A fields", () => {
    const ok = learnerUpdateSchema.safeParse(updateBase);
    expect(ok.success).toBe(true);

    expect(learnerUpdateSchema.safeParse({ ...updateBase, id: "" }).success).toBe(
      false
    );
    expect(
      learnerUpdateSchema.safeParse({
        id: "x",
        firstName: "A",
      }).success
    ).toBe(false);
  });

  it("does not accept gradeLevelId as a transfer substitute", () => {
    const result = learnerUpdateSchema.safeParse({
      ...updateBase,
      gradeLevelId: "other-grade",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("gradeLevelId" in result.data).toBe(false);
    }
  });
});

describe("learnerIdSchema", () => {
  it("requires non-empty id", () => {
    expect(learnerIdSchema.safeParse({ id: "abc" }).success).toBe(true);
    expect(learnerIdSchema.safeParse({ id: "" }).success).toBe(false);
    expect(learnerIdSchema.safeParse({}).success).toBe(false);
  });
});

describe("transferLearnerSchema", () => {
  it("accepts same-school transfer payload", () => {
    const result = transferLearnerSchema.safeParse({
      learnerId: "l1",
      targetGradeLevelId: "g2",
      targetTeacherId: "t2",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetSectionId).toBeUndefined();
    }
  });

  it("accepts optional targetSectionId", () => {
    const result = transferLearnerSchema.safeParse({
      learnerId: "l1",
      targetGradeLevelId: "g2",
      targetSectionId: "s1",
      targetTeacherId: "t2",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetSectionId).toBe("s1");
    }
  });

  it("treats empty section as undefined", () => {
    const result = transferLearnerSchema.safeParse({
      learnerId: "l1",
      targetGradeLevelId: "g2",
      targetSectionId: "",
      targetTeacherId: "t2",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetSectionId).toBeUndefined();
    }
  });

  it("preserves explicit No section clear sentinel", () => {
    const result = transferLearnerSchema.safeParse({
      learnerId: "l1",
      targetGradeLevelId: "g2",
      targetSectionId: SECTION_CLEAR,
      targetTeacherId: "t2",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetSectionId).toBe(SECTION_CLEAR);
    }
  });

  it("rejects missing learner or grade", () => {
    expect(
      transferLearnerSchema.safeParse({ targetGradeLevelId: "g2" }).success
    ).toBe(false);
    expect(transferLearnerSchema.safeParse({ learnerId: "l1" }).success).toBe(false);
  });

  it("allows an omitted teacher — Floating placements have no adviser", () => {
    // `transferLearner` requires a teacher for every non-FLOATING grade; only it
    // knows the target grade's type, so the schema cannot demand one here.
    const result = transferLearnerSchema.safeParse({
      learnerId: "l1",
      targetGradeLevelId: "g2",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetTeacherId).toBeUndefined();
    }
  });

  it("treats a blank teacher as omitted", () => {
    const result = transferLearnerSchema.safeParse({
      learnerId: "l1",
      targetGradeLevelId: GRADE_FLOATING,
      targetTeacherId: "   ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetTeacherId).toBeUndefined();
      expect(result.data.targetGradeLevelId).toBe(GRADE_FLOATING);
    }
  });
});

describe("transferLearnerCrossSchoolSchema", () => {
  it("accepts cross-school transfer payload", () => {
    const result = transferLearnerCrossSchoolSchema.safeParse({
      learnerId: "l1",
      targetSchoolId: "school-b",
      targetGradeLevelId: "g2",
      targetTeacherId: "t2",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetSchoolId).toBe("school-b");
      expect(result.data.targetSectionId).toBeUndefined();
    }
  });

  it("accepts optional targetSectionId and treats empty as undefined", () => {
    const withSection = transferLearnerCrossSchoolSchema.safeParse({
      learnerId: "l1",
      targetSchoolId: "school-b",
      targetGradeLevelId: "g2",
      targetSectionId: "s1",
      targetTeacherId: "t2",
    });
    expect(withSection.success).toBe(true);
    if (withSection.success) {
      expect(withSection.data.targetSectionId).toBe("s1");
    }

    const emptySection = transferLearnerCrossSchoolSchema.safeParse({
      learnerId: "l1",
      targetSchoolId: "school-b",
      targetGradeLevelId: "g2",
      targetSectionId: "",
      targetTeacherId: "t2",
    });
    expect(emptySection.success).toBe(true);
    if (emptySection.success) {
      expect(emptySection.data.targetSectionId).toBeUndefined();
    }
  });

  it("rejects missing target school or teacher", () => {
    expect(
      transferLearnerCrossSchoolSchema.safeParse({
        learnerId: "l1",
        targetGradeLevelId: "g2",
        targetTeacherId: "t2",
      }).success
    ).toBe(false);
    expect(
      transferLearnerCrossSchoolSchema.safeParse({
        learnerId: "l1",
        targetSchoolId: "school-b",
        targetGradeLevelId: "g2",
      }).success
    ).toBe(false);
  });
});
