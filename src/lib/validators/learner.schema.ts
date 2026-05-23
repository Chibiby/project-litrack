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

export const learnerCreateSchema = z.object({
  gradeLevelId: nonEmpty("Grade level required"),
  firstName: nonEmpty("First name required").max(80),
  middleName: z.string().trim().max(80).optional().or(z.literal("").transform(() => undefined)),
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
});

export type LearnerCreateInput = z.infer<typeof learnerCreateSchema>;

export const learnerUpdateSchema = learnerCreateSchema.partial().extend({
  id: nonEmpty(),
});
export type LearnerUpdateInput = z.infer<typeof learnerUpdateSchema>;
