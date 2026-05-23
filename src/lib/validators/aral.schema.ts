import { z } from "zod";
import { nonEmpty } from "./common";

export const aralProfileSchema = z.object({
  learnerId: nonEmpty(),
  // B
  modeOfTransportation: z.enum(["WALKING", "MOTORCYCLE", "BUS_JEEP_CAR"]),
  distanceHomeToSchool: z.enum(["LESS_THAN_1KM", "ONE_TO_FIVE_KM", "MORE_THAN_5KM"]),
  previousTransfers: z.enum(["NONE", "ONE", "MULTIPLE"]),
  transferDetails: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
  // C
  absenteeismFrequency: z.enum([
    "ONE_TO_THREE_PER_MONTH",
    "THREE_TO_FIVE_PER_MONTH",
    "MORE_THAN_FIVE_PER_MONTH",
    "WEEKLY",
    "OTHER",
  ]),
  absenteeismOtherReason: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
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
  lsenObservations: z.string().trim().max(1000).optional().or(z.literal("").transform(() => undefined)),
  furtherAssessment: z.array(z.enum(["MFAT", "OTHER"])).default([]),
  furtherAssessmentOther: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
});

export type AralProfileInput = z.infer<typeof aralProfileSchema>;
