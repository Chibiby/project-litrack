import { z } from "zod";
import { nonEmpty } from "./common";
import { getMonday } from "@/lib/utils";
import { monthStartOf } from "@/lib/month-range";

const READING_PROFILE = [
  "NON_DECODER_LOW_EMERGENT",
  "FRUSTRATION_HIGH_EMERGENT",
  "INSTRUCTIONAL_DEVELOPING",
  "INDEPENDENT_GRADE_READY",
] as const;

const WEEKLY_WORD_RECOGNITION_LEVEL = [
  "LEVEL_1",
  "LEVEL_2",
  "LEVEL_3",
  "LEVEL_4",
  "LEVEL_5",
  "LEVEL_0",
  "NA",
] as const;

const WEEKLY_READING_COMPREHENSION_LEVEL = [
  "LEVEL_1",
  "LEVEL_2",
  "LEVEL_3",
  "LEVEL_0",
  "NA",
] as const;

/** Mirrors the `WeeklyWritingLevel` enum; labels: WEEKLY_WRITING_LEVEL_LABELS. */
const WEEKLY_WRITING_LEVEL = [
  "LEVEL_1",
  "LEVEL_2",
  "LEVEL_3",
  "LEVEL_4",
  "LEVEL_5",
  "LEVEL_0",
  "NA",
] as const;

/** Coerce to Date, normalize to Monday 00:00 local. */
const weekStartField = z.coerce.date().transform((d) => getMonday(d));

/**
 * Coerce to Date, normalize to the 1st of that month at 00:00 local — the same
 * idea as `weekStartField`, one period up. Any date inside August 2026 posts as
 * `2026-08-01`, so a month is always addressed by one canonical anchor.
 */
const monthStartField = z.coerce.date().transform((d) => monthStartOf(d));

const notesField = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .or(z.literal("").transform(() => undefined));

/**
 * Writing level is optional (the column is nullable and older weekly rows have
 * none): missing, null and "" all mean "not recorded".
 */
const writingLevelField = z
  .enum(WEEKLY_WRITING_LEVEL)
  .nullish()
  .transform((v) => v ?? undefined)
  .or(z.literal("").transform(() => undefined));

export const readingLevelSchema = z.object({
  learnerId: nonEmpty(),
  weekStart: weekStartField,
  englishProfile: z.enum(READING_PROFILE),
  filipinoProfile: z.enum(READING_PROFILE),
  wordRecognitionLevel: z.enum(WEEKLY_WORD_RECOGNITION_LEVEL),
  readingComprehensionLevel: z.enum(WEEKLY_READING_COMPREHENSION_LEVEL),
  writingLevel: writingLevelField,
  notes: notesField,
});

export type ReadingLevelInput = z.infer<typeof readingLevelSchema>;

/**
 * One learner's assessment, shared by the weekly and monthly bulk schemas so the
 * two periods can never come to accept different fields.
 */
const bulkEntryFields = z.object({
  learnerId: nonEmpty(),
  englishProfile: z.enum(READING_PROFILE),
  filipinoProfile: z.enum(READING_PROFILE),
  wordRecognitionLevel: z.enum(WEEKLY_WORD_RECOGNITION_LEVEL),
  readingComprehensionLevel: z.enum(WEEKLY_READING_COMPREHENSION_LEVEL),
  writingLevel: writingLevelField,
  notes: notesField,
});

export const readingLevelBulkSchema = z.object({
  weekStart: weekStartField,
  entries: z.array(bulkEntryFields).min(1),
});

export type ReadingLevelBulkInput = z.infer<typeof readingLevelBulkSchema>;

/**
 * The monthly grid's payload. Identical to the weekly one except the period is a
 * month anchor — see `bulkRecordMonthlyReadingLevel` for why the stored column
 * is still named `weekStart`.
 */
export const readingLevelMonthlyBulkSchema = z.object({
  monthStart: monthStartField,
  entries: z.array(bulkEntryFields).min(1),
});

export type ReadingLevelMonthlyBulkInput = z.infer<typeof readingLevelMonthlyBulkSchema>;
