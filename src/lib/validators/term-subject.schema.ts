import { z } from "zod";
import { MAX_ACTIVE_SUBJECTS_PER_GRADE } from "@/lib/terms/subjects";

/**
 * End of Terms subject management payloads. None carries a `schoolId`: the
 * school is always derived server-side from the target grade or subject row.
 */

/** C0 controls and DEL. Checked by code point so the source holds no raw control bytes. */
const hasControlChar = (v: string) =>
  [...v].some((ch) => { const c = ch.codePointAt(0) ?? 0; return c < 32 || c === 127; });

export const termSubjectNameSchema = z
  .string({ required_error: "Subject name is required" })
  .trim()
  .min(1, "Subject name is required")
  .max(60, "Subject name must be 60 characters or fewer")
  .refine((v) => !hasControlChar(v), "Subject name contains invalid characters");

const id = z.string().min(1, "Invalid input");

export const createTermSubjectSchema = z.object({
  gradeLevelId: id,
  name: termSubjectNameSchema,
});

export const renameTermSubjectSchema = z.object({
  id,
  name: termSubjectNameSchema,
});

export const termSubjectIdSchema = z.object({ id });

export const reorderTermSubjectsSchema = z.object({
  gradeLevelId: id,
  orderedIds: z
    .array(id)
    .min(1, "Invalid input")
    .max(MAX_ACTIVE_SUBJECTS_PER_GRADE, "Invalid input"),
});

export const termSubjectGradeSchema = z.object({ gradeLevelId: id });

export type CreateTermSubjectInput = z.infer<typeof createTermSubjectSchema>;
export type RenameTermSubjectInput = z.infer<typeof renameTermSubjectSchema>;
export type ReorderTermSubjectsInput = z.infer<typeof reorderTermSubjectsSchema>;
