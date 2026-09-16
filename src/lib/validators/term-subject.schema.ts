import { z } from "zod";
import { isValidSubjectName, MAX_ACTIVE_SUBJECTS_PER_GRADE } from "@/lib/terms/subjects";

/**
 * End of Terms subject management payloads. None carries a `schoolId`: the
 * school is always derived server-side from the target grade or subject row.
 */

export const termSubjectNameSchema = z
  .string({ required_error: "Subject name is required" })
  .trim()
  .min(1, "Subject name is required")
  .max(60, "Subject name must be 60 characters or fewer")
  .refine(isValidSubjectName, "Subject name contains invalid characters");

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

/**
 * `resetSchoolTermSubjects`'s payload. `schoolId` is only ever HONOURED for a
 * Super Admin caller — a School Head's own `resetSchoolTermSubjects` call
 * always resets `user.schoolId`, ignoring whatever (if anything) is posted
 * here. Optional because the School Head's own page never needs to send it.
 */
export const resetSchoolTermSubjectsSchema = z.object({
  schoolId: id.optional(),
});

/**
 * `resetAllSchoolsTermSubjects`'s payload. A server-side guard, not a UX
 * nicety: typing the literal string is the only way this runs, so a stray
 * call with no body (or a body carrying anything else) is refused before any
 * school is touched.
 */
export const resetAllSchoolsTermSubjectsSchema = z.object({
  confirm: z.literal("RESET", { errorMap: () => ({ message: "Invalid input" }) }),
});

export type CreateTermSubjectInput = z.infer<typeof createTermSubjectSchema>;
export type RenameTermSubjectInput = z.infer<typeof renameTermSubjectSchema>;
export type ReorderTermSubjectsInput = z.infer<typeof reorderTermSubjectsSchema>;
export type ResetSchoolTermSubjectsInput = z.infer<typeof resetSchoolTermSubjectsSchema>;
export type ResetAllSchoolsTermSubjectsInput = z.infer<typeof resetAllSchoolsTermSubjectsSchema>;
