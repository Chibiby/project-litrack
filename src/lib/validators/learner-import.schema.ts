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

function refineEthnicityOther(
  data: {
    ethnicity?: (typeof ETHNICITY)[number];
    ethnicityOther?: string;
  },
  ctx: z.RefinementCtx
) {
  if (data.ethnicity === "OTHER" && !data.ethnicityOther?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Specify ethnicity when Others is selected",
      path: ["ethnicityOther"],
    });
  }
  if (
    data.ethnicity != null &&
    data.ethnicity !== "OTHER" &&
    data.ethnicityOther?.trim()
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Ethnicity details are only allowed when Others is selected",
      path: ["ethnicityOther"],
    });
  }
}

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

function refineSectionBTransfers(
  data: {
    previousTransfers?: (typeof TRANSFERS)[number];
    transferDetails?: string;
  },
  ctx: z.RefinementCtx
) {
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

/** Section A + optional B row for CSV import (gradeLevelId supplied by the route, not the file). */
export const learnerImportRowSchema = z
  .object({
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
    modeOfTransportation: optionalEnum(TRANSPORTATION),
    distanceHomeToSchool: optionalEnum(DISTANCE),
    previousTransfers: optionalEnum(TRANSFERS),
    transferDetails: optionalTransferDetails,
    isAralLearner: z.boolean().default(false),
    /** Optional section name from CSV; resolved to id at commit. */
    sectionName: z
      .union([z.string(), z.undefined(), z.null()])
      .transform((v) => {
        if (v == null) return undefined;
        const trimmed = String(v).trim();
        return trimmed.length > 0 ? trimmed : undefined;
      })
      .pipe(z.union([z.string().max(80), z.undefined()])),
  })
  .superRefine((data, ctx) => {
    refineFrustrationSubtypes(data, ctx);
    refineSectionBTransfers(data, ctx);
    refineEthnicityOther(data, ctx);
  });

export type LearnerImportRow = z.infer<typeof learnerImportRowSchema>;
