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

/** Grade levels selectable in School Head profiling School Structure (G1–G12 only). */
export const PROFILING_GRADE_LEVEL_TYPES = [
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

export const createGradeLevelSchema = z.object({
  type: z.enum(GRADE_LEVEL_TYPES),
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
