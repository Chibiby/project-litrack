import { z } from "zod";

export const GRADE_LEVEL_TYPES = [
  "KINDER",
  "G1",
  "G2",
  "G3",
  "G4",
  "G5",
  "G6",
  "G7",
  "G8",
  "G9",
  "G10",
  "G11",
  "G12",
  "FLOATING",
] as const;

/**
 * Grade levels a School Head may pick, in profiling School Structure and in the
 * Grade Levels page: Kinder + G1–G12. FLOATING is deliberately excluded — it is
 * created on demand to hold learners with no grade/section, not something a
 * School Head picks. Rendered in array order, so KINDER comes first.
 */
export const PROFILING_GRADE_LEVEL_TYPES = [
  "KINDER",
  "G1",
  "G2",
  "G3",
  "G4",
  "G5",
  "G6",
  "G7",
  "G8",
  "G9",
  "G10",
  "G11",
  "G12",
] as const;

/**
 * Same set as {@link PROFILING_GRADE_LEVEL_TYPES}, named for the manual-create
 * path so the FLOATING exclusion reads as intentional at the call site.
 */
export const CREATABLE_GRADE_LEVEL_TYPES = PROFILING_GRADE_LEVEL_TYPES;

// FLOATING is system-managed (see `ensureFloatingGradeLevel`), so it is not
// accepted here even though it is a valid `GradeLevelType`.
export const createGradeLevelSchema = z.object({
  type: z.enum(CREATABLE_GRADE_LEVEL_TYPES),
});

/** Bootstrap fields from School Head profiling (not part of survey profile schema). */
export const schoolStructureSchema = z.object({
  gradeTypes: z
    .array(z.enum(PROFILING_GRADE_LEVEL_TYPES))
    .min(1, "Select at least one grade level"),
  sectionsPerGrade: z.coerce
    .number({ invalid_type_error: "Sections per grade is required" })
    .int("Enter a whole number")
    .min(1, "At least 1 section per grade")
    .max(26, "At most 26 sections per grade (A–Z)"),
});

export type CreateGradeLevelInput = z.infer<typeof createGradeLevelSchema>;
export type SchoolStructureInput = z.infer<typeof schoolStructureSchema>;
