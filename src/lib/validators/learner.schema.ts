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

const optionalMiddleName = z
  .string()
  .trim()
  .max(80)
  .optional()
  .or(z.literal("").transform(() => undefined));

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

const sectionAFields = {
  firstName: nonEmpty("First name required").max(80),
  middleName: optionalMiddleName,
  lastName: nonEmpty("Last name required").max(80),
  age: z.coerce.number().int().min(3).max(25),
  gender: z.enum(["MALE", "FEMALE"]),
  englishReadingProfile: z.enum(READING_PROFILE),
  englishFrustrationSubtypes: z.array(z.enum(FRUSTRATION_SUBTYPE)).default([]),
  filipinoReadingProfile: z.enum(READING_PROFILE),
  filipinoFrustrationSubtypes: z.array(z.enum(FRUSTRATION_SUBTYPE)).default([]),
  governmentBenefits: z.array(z.enum(GOV_BENEFIT)).default([]),
  parentEducation: z.enum(PARENT_EDUCATION),
};

export const learnerCreateSchema = z
  .object({
    gradeLevelId: nonEmpty("Grade level required"),
    ...sectionAFields,
    isAralLearner: z.boolean().default(false),
    /** Client must re-submit with true after possible_duplicate warning. */
    confirmDuplicate: z
      .union([z.boolean(), z.literal("true"), z.literal("false"), z.literal("on"), z.literal("")])
      .optional()
      .transform((v) => v === true || v === "true" || v === "on"),
  })
  .superRefine(refineFrustrationSubtypes);

export type LearnerCreateInput = z.infer<typeof learnerCreateSchema>;

/** Edit Section A only (grade/section/teacher via transfer). */
export const learnerUpdateSchema = z
  .object({
    id: nonEmpty(),
    ...sectionAFields,
  })
  .superRefine(refineFrustrationSubtypes);

export type LearnerUpdateInput = z.infer<typeof learnerUpdateSchema>;

export const learnerIdSchema = z.object({
  id: nonEmpty("Learner id required"),
});

export type LearnerIdInput = z.infer<typeof learnerIdSchema>;
