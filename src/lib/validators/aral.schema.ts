import { z } from "zod";
import { nonEmpty } from "./common";

const optionalText = (max: number) =>
  z.string().trim().max(max).optional().or(z.literal("").transform(() => undefined));

/** ARAL Update Data — Sections C, D, E only (Section B lives on Learner). */
export const aralProfileSchema = z
  .object({
    learnerId: nonEmpty(),
    // C
    absenteeismFrequency: z.enum([
      "ONE_TO_THREE_PER_MONTH",
      "THREE_TO_FIVE_PER_MONTH",
      "MORE_THAN_FIVE_PER_MONTH",
      "WEEKLY",
      "OTHER",
    ]),
    absenteeismOtherReason: optionalText(500),
    // Which reasons apply, alongside how often and the free-text specify field.
    // Optional: profiles saved before this list existed hold none, and a teacher
    // editing one is not forced to invent a reason to save the rest of the form.
    absenteeismReasons: z
      .array(
        z.enum([
          "FAMILY_EMERGENCY",
          "FINANCIAL_DIFFICULTIES",
          "LACK_OF_TRANSPORTATION",
          "DISTANCE_FROM_SCHOOL",
          "HOUSEHOLD_CHORES",
          "CARING_FOR_FAMILY",
          "BAD_WEATHER",
          "ACADEMIC_DIFFICULTIES",
          "LACK_OF_INTEREST",
          "BULLYING",
          "SCHOOL_CONCERNS",
          "GADGET_SOCIAL_MEDIA",
          "LIVELIHOOD_WORK",
          "FAMILY_RELOCATION",
          "SAFETY_CONCERNS",
          "MEDICAL_APPOINTMENTS",
          "COMPETITIONS_ACTIVITIES",
          "LACK_OF_SUPPLIES",
        ])
      )
      .default([]),
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
