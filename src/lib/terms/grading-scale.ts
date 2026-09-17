import type { TermMark } from "@prisma/client";
import { TERM_MARK_LABELS, TERM_MARK_SHORT_LABELS } from "@/lib/constants/enum-labels";
import { generalAverage } from "@/lib/terms/average";

/**
 * Which End of Terms grading scale a grade uses. Pure and client-safe: the
 * grid, the save action, the sheet figures and both exports all ask here, so
 * "which grades use letters" is decided in exactly one place.
 *
 * Grade 1 records a letter mark (A – Advancing … E – Emerging); every other
 * term-sheet grade records a numeric score 60–100. Kindergarten has its own
 * competency checklist and never reaches this sheet.
 *
 * `gradeType` must come from an authorized placement or a tenant-scoped grade
 * read, never from a client-posted field.
 */
const LETTER_SCALE_GRADE_TYPES: ReadonlySet<string> = new Set(["G1"]);

export type TermGradingScale = "LETTER" | "NUMERIC";

export type TermCell = { score: number | null; mark: TermMark | null };

export function termGradingScale(gradeType: string): TermGradingScale {
  return LETTER_SCALE_GRADE_TYPES.has(gradeType) ? "LETTER" : "NUMERIC";
}

/** "A – Advancing" (en dash) for a mark. */
export function termMarkText(mark: TermMark): string {
  return `${TERM_MARK_SHORT_LABELS[mark]} – ${TERM_MARK_LABELS[mark]}`;
}

/**
 * A cell's export/report text: the full label for a mark, the number for a
 * score, "" for neither. A Grade 1 row saved before letter marks still holds a
 * score and shows it as the number.
 */
export function termCellText(cell: TermCell): string {
  if (cell.mark) return termMarkText(cell.mark);
  if (cell.score !== null) return String(cell.score);
  return "";
}

/**
 * General Average for one learner's row, or null when the row has none: a
 * LETTER-scale grade never shows one (not even over legacy numeric cells), and
 * a row holding any mark cannot be averaged. Otherwise the same mean of filled
 * cells `generalAverage` computes.
 */
export function rowGeneralAverage(
  gradeType: string,
  cells: readonly (TermCell | null | undefined)[]
): number | null {
  if (termGradingScale(gradeType) === "LETTER") return null;
  if (cells.some((c) => c?.mark)) return null;
  return generalAverage(cells.map((c) => c?.score));
}
