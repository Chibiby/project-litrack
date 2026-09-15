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
 * Subjects are the grade's School Head-managed `TermSubject` rows, posted by id.
 * The server re-checks every id against the grade's active list, so this schema
 * only asserts shape.
 */
export const termGradesSaveSchema = z.object({
  gradeLevelId: z.string().min(1),
  /**
   * Which advisory section the cells belong to. Optional: a teacher with one
   * advisory names nothing. A multi-advisory teacher's sheet sends one save per
   * section, each naming it, so the gate resolves exactly one placement.
   */
  sectionId: z.string().min(1).optional(),
  term: z.enum(["FIRST", "SECOND", "THIRD"]),
  entries: z
    .array(
      z.object({
        learnerId: z.string().min(1),
        termSubjectId: z.string().min(1),
        score: z.number().int().min(60).max(100).nullable(),
      })
    )
    .min(1)
    // Worst legitimate payload is one full page re-typed: 100 learners x 15
    // subjects (the per-grade cap) = 1500.
    .max(1500, "Too many cells in one save"),
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
export const termGradesExportSchema = z
  .object({
    /** Required for a Super Admin and for a single-sheet teacher export. */
    gradeLevelId: z.string().min(1).optional(),
    term: z.enum(["FIRST", "SECOND", "THIRD"]),
    section: z.string().optional(),
    q: z.string().optional(),
    /**
     * A teacher's advisory sections to export, one worksheet each (the All
     * Advisories sheet). Every id passes the same advisory gate a single
     * export does; a teacher advises at most three.
     */
    sectionIds: z.array(z.string().min(1)).min(1).max(3).optional(),
  })
  .refine((v) => v.gradeLevelId || v.sectionIds, {
    message: "Invalid input",
  });

export type TermGradesExportInput = z.infer<typeof termGradesExportSchema>;
