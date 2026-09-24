import { allowedReadingValuesForGrade } from "@/lib/reading/policy";

/**
 * Month-over-month movement of one learner's reading level in one language
 * (spec 4.5, Q4 default).
 *
 * - `improved`: a higher level than the previous month.
 * - `same`: the same level ("no improvement").
 * - `declined`: a lower level. Reported on its own, never folded into "no
 *   improvement".
 * - `not_comparable`: either value is not on the grade's scale — typically a
 *   learner promoted out of Kinder still carrying a letter-rubric value that
 *   has no rank on Grade 1's reading bands.
 *
 * A level's rank is its index in the grade's scale (`allowedReadingValuesForGrade`,
 * the same order `readingProfileOptionsForGrade` shows), lowest first.
 */
export type ReadingMovement = "improved" | "same" | "declined" | "not_comparable";

export const READING_MOVEMENTS: readonly ReadingMovement[] = [
  "improved",
  "same",
  "declined",
  "not_comparable",
];

export const READING_MOVEMENT_LABELS: Record<ReadingMovement, string> = {
  improved: "Improved (moved up a level)",
  same: "No improvement (same level)",
  declined: "Declined (moved down a level)",
  not_comparable: "Not comparable (level not on this grade's scale)",
};

export function classifyReadingMovement(
  previous: string,
  current: string,
  gradeType: string
): ReadingMovement {
  const scale = allowedReadingValuesForGrade(gradeType);
  const before = scale.indexOf(previous);
  const after = scale.indexOf(current);
  if (before === -1 || after === -1) return "not_comparable";
  if (after > before) return "improved";
  if (after < before) return "declined";
  return "same";
}
