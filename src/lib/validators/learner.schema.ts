import { z } from "zod";
import { nonEmpty } from "./common";

const READING_PROFILE = [
  "NON_DECODER_LOW_EMERGENT",
  "FRUSTRATION_HIGH_EMERGENT",
  "INSTRUCTIONAL_DEVELOPING",
  "INDEPENDENT_GRADE_READY",
] as const;

const FRUSTRATION_SUBTYPE = ["DECODING", "COMPREHENSION_ALL", "COMPREHENSION_CRITICAL"] as const;

const GOV_BENEFIT = ["FOUR_PS", "IPS"] as const;

const PARENT_EDUCATION = [
  "NO_FORMAL", "ELEMENTARY_LEVEL", "ELEMENTARY_GRADUATE",
  "SECONDARY_LEVEL", "SECONDARY_GRADUATE", "COLLEGE_LEVEL", "COLLEGE_GRADUATE",
] as const;

const TRANSPORTATION = ["WALKING", "MOTORCYCLE", "BUS_JEEP_CAR"] as const;
const DISTANCE = ["LESS_THAN_1KM", "ONE_TO_FIVE_KM", "MORE_THAN_5KM"] as const;
const TRANSFERS = ["NONE", "ONE", "MULTIPLE"] as const;

const ETHNICITY = [
  "BISAYA", "ILONGGO", "BLAAN", "TAGAKAOLO", "TBOLI", "BADJAO", "MARANAO",
  "TAUSOG", "MAGUINDANAON", "ILOCANO", "TAGALOG", "FOREIGN", "OTHER",
] as const;

const optionalMiddleName = z
  .string()
  .trim()
  .max(80)
  .optional()
  .or(z.literal("").transform(() => undefined));

/** Empty / whitespace → undefined; otherwise require uuid. */
function optionalUuid(message: string) {
  return z
    .union([z.string(), z.undefined(), z.null()])
    .transform((v) => {
      if (v == null) return undefined;
      const trimmed = String(v).trim();
      return trimmed.length > 0 ? trimmed : undefined;
    })
    .pipe(z.union([z.string().uuid(message), z.undefined()]));
}

const optionalSectionId = optionalUuid("Invalid section");

/** Empty string / null → undefined for optional enums. */
function optionalEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(
    (v) => (v === "" || v == null ? undefined : v),
    z.enum(values).optional()
  );
}

const optionalTransferDetails = z
  .string()
  .trim()
  .max(500)
  .optional()
  .or(z.literal("").transform(() => undefined));

const optionalEthnicityOther = z
  .string()
  .trim()
  .max(80)
  .optional()
  .or(z.literal("").transform(() => undefined));

/** Free-text ethnicity required for (and limited to) "Others, please specify". */
function refineEthnicityOther<
  T extends {
    ethnicity?: (typeof ETHNICITY)[number];
    ethnicityOther?: string;
  },
>(data: T, ctx: z.RefinementCtx) {
  if (data.ethnicity === "OTHER" && !data.ethnicityOther?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Please specify the ethnicity",
      path: ["ethnicityOther"],
    });
  }
  if (data.ethnicity !== "OTHER" && data.ethnicityOther?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Ethnicity details are only allowed when Others is selected",
      path: ["ethnicityOther"],
    });
  }
}

/** Frustration subtypes only when Frustration/High Emergent is selected (L-A4/L-A5). */
function refineFrustrationSubtypes<
  T extends {
    englishReadingProfile: (typeof READING_PROFILE)[number];
    englishFrustrationSubtypes: (typeof FRUSTRATION_SUBTYPE)[number][];
    filipinoReadingProfile: (typeof READING_PROFILE)[number];
    filipinoFrustrationSubtypes: (typeof FRUSTRATION_SUBTYPE)[number][];
  },
>(data: T, ctx: z.RefinementCtx) {
  if (
    data.englishReadingProfile !== "FRUSTRATION_HIGH_EMERGENT" &&
    data.englishFrustrationSubtypes.length > 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "English frustration subtypes are only allowed when Frustration/High Emergent is selected",
      path: ["englishFrustrationSubtypes"],
    });
  }
  if (
    data.filipinoReadingProfile !== "FRUSTRATION_HIGH_EMERGENT" &&
    data.filipinoFrustrationSubtypes.length > 0
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Filipino frustration subtypes are only allowed when Frustration/High Emergent is selected",
      path: ["filipinoFrustrationSubtypes"],
    });
  }
}

/** Section B transfer details rules when previousTransfers is provided. */
function refineSectionBTransfers<
  T extends {
    previousTransfers?: (typeof TRANSFERS)[number];
    transferDetails?: string;
  },
>(data: T, ctx: z.RefinementCtx) {
  if (data.previousTransfers === "MULTIPLE" && !data.transferDetails?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Specify transfer details when Multiple transfers is selected",
      path: ["transferDetails"],
    });
  }
  if (
    data.previousTransfers != null &&
    data.previousTransfers !== "MULTIPLE" &&
    data.transferDetails?.trim()
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Transfer details are only allowed when Multiple transfers is selected",
      path: ["transferDetails"],
    });
  }
}

const sectionAFields = {
  firstName: nonEmpty("First name required").max(80),
  middleName: optionalMiddleName,
  lastName: nonEmpty("Last name required").max(80),
  age: z.coerce.number().int().min(3).max(25),
  gender: z.enum(["MALE", "FEMALE"]),
  ethnicity: optionalEnum(ETHNICITY),
  ethnicityOther: optionalEthnicityOther,
  englishReadingProfile: z.enum(READING_PROFILE),
  englishFrustrationSubtypes: z.array(z.enum(FRUSTRATION_SUBTYPE)).default([]),
  filipinoReadingProfile: z.enum(READING_PROFILE),
  filipinoFrustrationSubtypes: z.array(z.enum(FRUSTRATION_SUBTYPE)).default([]),
  governmentBenefits: z.array(z.enum(GOV_BENEFIT)).default([]),
  parentEducation: z.enum(PARENT_EDUCATION),
};

/** Optional Section B (nullable on Learner). */
const sectionBFields = {
  modeOfTransportation: optionalEnum(TRANSPORTATION),
  distanceHomeToSchool: optionalEnum(DISTANCE),
  previousTransfers: optionalEnum(TRANSFERS),
  transferDetails: optionalTransferDetails,
};

export const learnerCreateSchema = z
  .object({
    gradeLevelId: nonEmpty("Grade level required"),
    sectionId: optionalSectionId,
    ...sectionAFields,
    ...sectionBFields,
    /** Client must re-submit with true after possible_duplicate warning. */
    confirmDuplicate: z
      .union([z.boolean(), z.literal("true"), z.literal("false"), z.literal("on"), z.literal("")])
      .optional()
      .transform((v) => v === true || v === "true" || v === "on"),
  })
  .superRefine((data, ctx) => {
    refineFrustrationSubtypes(data, ctx);
    refineSectionBTransfers(data, ctx);
    refineEthnicityOther(data, ctx);
  });

export type LearnerCreateInput = z.infer<typeof learnerCreateSchema>;

/** Edit Section A + B (+ optional section); grade/teacher via transfer. */
export const learnerUpdateSchema = z
  .object({
    id: nonEmpty(),
    sectionId: optionalSectionId,
    ...sectionAFields,
    ...sectionBFields,
  })
  .superRefine((data, ctx) => {
    refineFrustrationSubtypes(data, ctx);
    refineSectionBTransfers(data, ctx);
    refineEthnicityOther(data, ctx);
  });

export type LearnerUpdateInput = z.infer<typeof learnerUpdateSchema>;

export const learnerIdSchema = z.object({
  id: nonEmpty("Learner id required"),
});

export type LearnerIdInput = z.infer<typeof learnerIdSchema>;

/** Bulk soft-delete from the roster's selection bar. */
export const deleteLearnersSchema = z.object({
  learnerIds: z.array(nonEmpty()).min(1, "Select at least one learner"),
});

export type DeleteLearnersInput = z.infer<typeof deleteLearnersSchema>;

/** Bulk enroll existing grade learners into ARAL. */
export const enrollLearnersToAralSchema = z.object({
  gradeId: nonEmpty("Grade required"),
  learnerIds: z.array(nonEmpty()).min(1, "Select at least one learner"),
  /**
   * Who tutors them. Omitted means the enrolling teacher takes it themselves,
   * which is what the picker defaults to. Any teacher at the school is valid —
   * DepEd or not, advisory section or not — so this is only shape-checked here;
   * the action verifies the person.
   */
  aralTeacherId: optionalUuid("Invalid teacher"),
});

export type EnrollLearnersToAralInput = z.infer<typeof enrollLearnersToAralSchema>;

/**
 * Enroll (or move) learners picked from the teacher roster, which spans every
 * grade the teacher holds — so there is no `gradeId` to check them against. The
 * action scopes them to the caller's own learners instead.
 */
export const enrollRosterLearnersToAralSchema = z.object({
  learnerIds: z.array(nonEmpty()).min(1, "Select at least one learner"),
  /** Same rule as above: shape-checked here, the person is verified in the action. */
  aralTeacherId: optionalUuid("Invalid teacher"),
});

export type EnrollRosterLearnersToAralInput = z.infer<
  typeof enrollRosterLearnersToAralSchema
>;
