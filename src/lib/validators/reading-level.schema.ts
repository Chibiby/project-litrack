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
 * The `readingLevelSchema` above and `readingLevelBulkSchema` (weekly, dead in
 * `src/` but kept) are UNCHANGED and deliberately so: the single-learner form is
 * one assessment a teacher fills in one sitting, so a blank field there is a
 * mistake worth rejecting. The monthly grid below is a bulk sheet a teacher
 * revisits across a whole class over days — partial encoding is the normal,
 * in-progress state, not an error — so its entry fields are all optional and a
 * row is only rejected when it carries nothing at all. Do not "fix" this
 * asymmetry by making the two agree; they answer different questions.
 */

/**
 * One learner's assessment for the WEEKLY bulk schema — every field required,
 * matching `readingLevelSchema`'s single-record strictness.
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
 * One learner's row on the MONTHLY grid. Every value field is optional — the
 * grid saves whatever a teacher has filled in so far, not a completed
 * assessment — using the same nullish-then-empty-string idiom as
 * `writingLevelField` for each of the other five. An entry with every field
 * absent carries nothing to save and is rejected: the teacher should have
 * cleared that learner's row (see `clears` below) instead of submitting it
 * empty.
 */
const monthlyBulkEntryFields = z
  .object({
    learnerId: nonEmpty(),
    englishProfile: z
      .enum(READING_PROFILE)
      .nullish()
      .transform((v) => v ?? undefined)
      .or(z.literal("").transform(() => undefined)),
    filipinoProfile: z
      .enum(READING_PROFILE)
      .nullish()
      .transform((v) => v ?? undefined)
      .or(z.literal("").transform(() => undefined)),
    wordRecognitionLevel: z
      .enum(WEEKLY_WORD_RECOGNITION_LEVEL)
      .nullish()
      .transform((v) => v ?? undefined)
      .or(z.literal("").transform(() => undefined)),
    readingComprehensionLevel: z
      .enum(WEEKLY_READING_COMPREHENSION_LEVEL)
      .nullish()
      .transform((v) => v ?? undefined)
      .or(z.literal("").transform(() => undefined)),
    writingLevel: writingLevelField,
    notes: notesField,
  })
  .superRefine((entry, ctx) => {
    // `notes` is falsy-but-not-undefined on an empty string: `notesField`'s
    // first union branch is a plain optional string, which accepts "" as a
    // valid (trimmed, still-empty) value before ever trying the
    // literal-"" -> undefined branch. A falsy check is what actually catches
    // "nothing here" for that field; every other field below is either a real
    // enum value or `undefined`, never "".
    const allAbsent =
      entry.englishProfile === undefined &&
      entry.filipinoProfile === undefined &&
      entry.wordRecognitionLevel === undefined &&
      entry.readingComprehensionLevel === undefined &&
      entry.writingLevel === undefined &&
      !entry.notes;
    if (allAbsent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An empty row must be cleared, not saved",
      });
    }
  });

export type MonthlyReadingLevelEntry = z.infer<typeof monthlyBulkEntryFields>;

/**
 * The monthly grid's payload. The period is a month anchor — see
 * `bulkRecordMonthlyReadingLevel` for why the stored column is still named
 * `weekStart`.
 *
 * `entries` carries partial rows to upsert; `clears` carries learner ids whose
 * month should be wiped instead. A save with neither is refused, and a learner
 * id may not appear in both — that would be an upsert and a delete of the same
 * row in one request, and which one should win is not this schema's call to
 * make silently.
 */
export const readingLevelMonthlyBulkSchema = z
  .object({
    monthStart: monthStartField,
    // Bounded because the grid is NOT a diff: it posts every row that carries
    // anything, seeded from the existing DB records, so a fully-encoded page
    // re-posts all of its rows on every save. At the 100-learner page size that
    // is 100 entries; 200 is headroom without letting one request become
    // unbounded.
    entries: z.array(monthlyBulkEntryFields).max(200, "Too many rows in one save"),
    clears: z.array(nonEmpty()).max(200, "Too many rows in one save").optional().default([]),
  })
  .superRefine((data, ctx) => {
    if (data.entries.length + data.clears.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Nothing to save" });
      return;
    }
    const clearSet = new Set(data.clears);
    const both = data.entries.some((e) => clearSet.has(e.learnerId));
    if (both) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A learner cannot be both saved and cleared in the same request",
      });
    }
  });

export type ReadingLevelMonthlyBulkInput = z.infer<typeof readingLevelMonthlyBulkSchema>;
