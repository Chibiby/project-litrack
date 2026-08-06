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
  "NO_FORMAL",
  "ELEMENTARY_LEVEL",
  "ELEMENTARY_GRADUATE",
  "SECONDARY_LEVEL",
  "SECONDARY_GRADUATE",
  "COLLEGE_LEVEL",
  "COLLEGE_GRADUATE",
] as const;

const optionalMiddleName = z
  .string()
  .trim()
  .max(80)
  .optional()
  .or(z.literal("").transform(() => undefined));

function refineFrustrationSubtypes(
  data: {
    englishReadingProfile: (typeof READING_PROFILE)[number];
    englishFrustrationSubtypes: (typeof FRUSTRATION_SUBTYPE)[number][];
    filipinoReadingProfile: (typeof READING_PROFILE)[number];
    filipinoFrustrationSubtypes: (typeof FRUSTRATION_SUBTYPE)[number][];
  },
  ctx: z.RefinementCtx
) {
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

/** Section A row for CSV import (gradeLevelId supplied by the route, not the file). */
export const learnerImportRowSchema = z
  .object({
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
    isAralLearner: z.boolean().default(false),
  })
  .superRefine(refineFrustrationSubtypes);

export type LearnerImportRow = z.infer<typeof learnerImportRowSchema>;
