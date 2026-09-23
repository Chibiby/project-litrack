import { z } from "zod";
import { KINDER_COMPETENCY_COUNT } from "@/lib/terms/kinder-competencies";
import { reportPurposeSchema } from "./report.schema";

/**
 * Kindergarten End-of-Term competency checklist save payload — see
 * docs/superpowers/specs/2026-09-16-kinder-end-of-term-checklist.md section 6.
 *
 * Diffs at the row grain the table is keyed on: one entry per touched
 * `competencyKey`, each entry carrying only the fields the teacher touched.
 * `undefined` on a rating/remark field means "not touched, leave the stored
 * value alone"; `null` means "clear it"; a value sets it — the same semantics
 * as a Prisma `update` input, which is what lets the action write a plain
 * per-row `upsert` instead of `saveTermGrades`'s raw-SQL bulk path.
 *
 * `competencyKey` is asserted here as non-empty shape only; the action
 * re-validates every value against `isKinderCompetencyKey` server-side, so a
 * stale or hand-crafted key can never resolve to a different competency than
 * the one that key names in the catalog.
 */
export const kinderCompetencySaveSchema = z.object({
  advisorySectionId: z.string().min(1),
  learnerId: z.string().min(1),
  entries: z
    .array(
      z.object({
        competencyKey: z.string().min(1),
        t1Rating: z.enum(["BEGINNING", "DEVELOPING", "CONSISTENT"]).nullable().optional(),
        t2Rating: z.enum(["BEGINNING", "DEVELOPING", "CONSISTENT"]).nullable().optional(),
        t3Rating: z.enum(["BEGINNING", "DEVELOPING", "CONSISTENT"]).nullable().optional(),
        remark: z.string().max(500).nullable().optional(),
      })
    )
    .min(1)
    // Never re-hardcoded: the catalog is the single source for how many rows a
    // saved sheet can cover.
    .max(KINDER_COMPETENCY_COUNT),
});

export type KinderCompetencySaveInput = z.infer<typeof kinderCompetencySaveSchema>;

/**
 * Export filters for one learner's checklist. `advisorySectionId` mirrors
 * `termGradesExportSchema`'s optional `sectionId`: a teacher with exactly one
 * Kinder advisory names nothing.
 */
export const kinderCompetencyExportSchema = z.object({
  learnerId: z.string().min(1),
  advisorySectionId: z.string().min(1).optional(),
  /** PRINT (default) or RECORDS — see `reportPurposeSchema`. */
  purpose: reportPurposeSchema,
});

export type KinderCompetencyExportInput = z.infer<typeof kinderCompetencyExportSchema>;
