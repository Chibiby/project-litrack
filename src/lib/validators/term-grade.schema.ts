import { z } from "zod";

/**
 * End of Terms grade sheet payloads.
 *
 * `score` is nullable and the floor is 60, not 75. 75 is DepEd's *passing* mark,
 * not its floor — a 75 floor would make a failing learner unrecordable and push
 * teachers into entering a false 75. `null` means "cleared": the column is a
 * non-nullable `Int`, so the save action deletes the row rather than writing a
 * null.
 *
 * The subject list is the JHS 8 from the approved sheet, used for every grade by
 * explicit decision. `LearningArea` in the schema is the authority; this literal
 * union mirrors it so the client can post without importing Prisma types.
 */
export const termGradesSaveSchema = z.object({
  gradeLevelId: z.string().min(1),
  term: z.enum(["FIRST", "SECOND", "THIRD"]),
  entries: z
    .array(
      z.object({
        learnerId: z.string().min(1),
        subject: z.enum([
          "ENGLISH",
          "FILIPINO",
          "MATHEMATICS",
          "SCIENCE",
          "ARALING_PANLIPUNAN",
          "EDUKASYON_SA_PAGPAPAKATAO",
          "MAPEH",
          "TLE",
        ]),
        score: z.number().int().min(60).max(100).nullable(),
      })
    )
    .min(1)
    // Worst legitimate payload is one full page re-typed: 100 learners x 8
    // subjects = 800. 1000 is headroom; past that it is not a grade sheet.
    .max(1000, "Too many cells in one save"),
});

export type TermGradesSaveInput = z.infer<typeof termGradesSaveSchema>;

/**
 * Export filters. `section` and `q` mirror the roster list params so the workbook
 * contains exactly the rows the teacher was looking at, not the whole grade.
 *
 * Deliberately carries no `schoolId`: a teacher's school comes from their session
 * and a Super Admin's is derived from `gradeLevelId`, so a client-supplied one
 * would only be an attack surface.
 */
export const termGradesExportSchema = z.object({
  gradeLevelId: z.string().min(1),
  term: z.enum(["FIRST", "SECOND", "THIRD"]),
  section: z.string().optional(),
  q: z.string().optional(),
});

export type TermGradesExportInput = z.infer<typeof termGradesExportSchema>;
