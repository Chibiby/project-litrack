import { z } from "zod";
import { nonEmpty } from "./common";

const READING_PROFILE = [
  "NON_DECODER_LOW_EMERGENT",
  "FRUSTRATION_HIGH_EMERGENT",
  "INSTRUCTIONAL_DEVELOPING",
  "INDEPENDENT_GRADE_READY",
] as const;

export const readingLevelSchema = z.object({
  learnerId: nonEmpty(),
  monthYear: z.string().regex(/^\d{4}-\d{2}$/, "Format: YYYY-MM"),
  englishProfile: z.enum(READING_PROFILE),
  filipinoProfile: z.enum(READING_PROFILE),
  notes: z.string().trim().max(1000).optional().or(z.literal("").transform(() => undefined)),
});

export type ReadingLevelInput = z.infer<typeof readingLevelSchema>;
