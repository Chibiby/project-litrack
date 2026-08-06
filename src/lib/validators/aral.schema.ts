import { z } from "zod";
import { nonEmpty } from "./common";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));

export const aralProfileSchema = z
  .object({
    learnerId: nonEmpty(),
    // B
    modeOfTransportation: z.enum(["WALKING", "MOTORCYCLE", "BUS_JEEP_CAR"]),
    distanceHomeToSchool: z.enum(["LESS_THAN_1KM", "ONE_TO_FIVE_KM", "MORE_THAN_5KM"]),
    previousTransfers: z.enum(["NONE", "ONE", "MULTIPLE"]),
    transferDetails: optionalText(500),
    // C
    absenteeismFrequency: z.enum([
      "ONE_TO_THREE_PER_MONTH",
      "THREE_TO_FIVE_PER_MONTH",
      "MORE_THAN_FIVE_PER_MONTH",
      "WEEKLY",
      "OTHER",
    ]),
    absenteeismOtherReason: optionalText(500),
    letterRecognition: z.enum(["ALL_EASY", "CONFUSES_SIMILAR", "STRUGGLES_RECALL", "NA"]),
    letterSoundCorrespondence: z.enum(["ACCURATE", "INCONSISTENT", "UNABLE", "NA"]),
    wordRecognition: z.enum([
      "READS_HF_FLUENT", "GUESSES", "OMITS_ADDS_REPLACES", "STRUGGLES_SIGHT_WORDS", "NA",
    ]),
    // D
    homeLiteracyEnvironment: z.enum(["HAS_ACCESS", "LIMITED", "NONE", "NA"]),
    parentalSupport: z.enum(["REGULAR", "LIMITED", "NONE", "NA"]),
    classroomEnvironment: z.enum(["SMALL_CLASS", "LARGE_CLASS", "NA"]),
    languageConsiderations: z
      .array(z.enum(["MATCHES_LOI", "DIFFERENT_DIALECT", "STRUGGLES_TRANSITION", "NA"]))
      .default([]),
    // E
    suggestedInterventions: z
      .array(z.enum([
        "PHONEMIC_AWARENESS", "LETTER_SOUND_DRILLS", "SIGHT_WORD_PRACTICE",
        "STRUCTURED_PHONICS", "ONE_ON_ONE", "HOME_READING", "LSEN_OTHER",
      ]))
      .default([]),
    lsenObservations: optionalText(1000),
    furtherAssessment: z.array(z.enum(["MFAT", "OTHER"])).default([]),
    furtherAssessmentOther: optionalText(500),
  })
  .superRefine((data, ctx) => {
    // L-B3: Specify required when Multiple transfers
    if (data.previousTransfers === "MULTIPLE" && !data.transferDetails?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Specify transfer details when Multiple transfers is selected",
        path: ["transferDetails"],
      });
    }
    if (data.previousTransfers !== "MULTIPLE" && data.transferDetails?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Transfer details are only allowed when Multiple transfers is selected",
        path: ["transferDetails"],
      });
    }

    // L-C1: Specify reason accompanies absenteeism selection (DOCX)
    if (!data.absenteeismOtherReason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Specify the reason for absenteeism frequency",
        path: ["absenteeismOtherReason"],
      });
    }

    // L-E1: LSEN observations required when LSEN_OTHER selected
    if (data.suggestedInterventions.includes("LSEN_OTHER") && !data.lsenObservations?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Specify LSEN observations when that intervention is selected",
        path: ["lsenObservations"],
      });
    }
    if (!data.suggestedInterventions.includes("LSEN_OTHER") && data.lsenObservations?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "LSEN observations are only allowed when the LSEN intervention is selected",
        path: ["lsenObservations"],
      });
    }

    // L-E2: Other assessment specify required
    if (data.furtherAssessment.includes("OTHER") && !data.furtherAssessmentOther?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Specify further assessment when Other is selected",
        path: ["furtherAssessmentOther"],
      });
    }
    if (!data.furtherAssessment.includes("OTHER") && data.furtherAssessmentOther?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Further assessment details are only allowed when Other is selected",
        path: ["furtherAssessmentOther"],
      });
    }
  });

export type AralProfileInput = z.infer<typeof aralProfileSchema>;
