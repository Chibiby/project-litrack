import { z } from "zod";
import {
  MAX_ACTIVE_SUBJECTS_PER_GRADE,
  TERM_SHEET_GRADE_TYPES,
} from "@/lib/terms/subjects";
import { termSubjectNameSchema } from "@/lib/validators/term-subject.schema";

/**
 * Super Admin management of the per-`GradeLevelType` End of Terms subject
 * templates (`TermSubjectDefault`). None of these carry a `schoolId` — the
 * table is tenant-less, scoped only by `gradeLevelType`.
 *
 * `gradeLevelType` is restricted to `TERM_SHEET_GRADE_TYPES` (every value
 * except `FLOATING`), so a `FLOATING` request is refused here as
 * `VALIDATION_FAILED` before any query runs, rather than reaching the action
 * and being refused there.
 */
const gradeLevelType = z.enum(TERM_SHEET_GRADE_TYPES, {
  errorMap: () => ({ message: "Invalid grade level type" }),
});

const id = z.string().min(1, "Invalid input");

export const createTermSubjectDefaultSchema = z.object({
  gradeLevelType,
  name: termSubjectNameSchema,
});

export const renameTermSubjectDefaultSchema = z.object({
  id,
  name: termSubjectNameSchema,
});

export const termSubjectDefaultIdSchema = z.object({ id });

export const reorderTermSubjectDefaultsSchema = z.object({
  gradeLevelType,
  orderedIds: z
    .array(id)
    .min(1, "Invalid input")
    .max(MAX_ACTIVE_SUBJECTS_PER_GRADE, "Invalid input"),
});

export type CreateTermSubjectDefaultInput = z.infer<typeof createTermSubjectDefaultSchema>;
export type RenameTermSubjectDefaultInput = z.infer<typeof renameTermSubjectDefaultSchema>;
export type ReorderTermSubjectDefaultsInput = z.infer<
  typeof reorderTermSubjectDefaultsSchema
>;
