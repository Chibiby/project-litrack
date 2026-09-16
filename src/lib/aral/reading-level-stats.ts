import { readingProfileOptionsForGrade } from "@/lib/reading/policy";

/**
 * The reading-profile fields this module ranks. `wordRecognitionLevel` and
 * `readingComprehensionLevel` are a DIFFERENT enum (`LEVEL_0`..`LEVEL_5`) —
 * see `aral-monthly-reading-level-grid-form.tsx`'s `WORD_RECOGNITION_BAND`/
 * `READING_COMPREHENSION_BAND` — and are deliberately excluded from the
 * average this module computes.
 */
export type ReadingLevelStatsRecord = {
  englishProfile: string | null;
  filipinoProfile: string | null;
};

export type ReadingLevelStatsInput = {
  /** Learners in the filtered set. */
  total: number;
  /** Learners in the filtered set with a complete assessment saved this month — already computed server-side by `countMonthlyAssessmentProgress`. Never recounted here. */
  completed: number;
  /** Every matching learner's saved record for the month, at most one per learner. */
  records: ReadingLevelStatsRecord[];
  gradeType: string;
};

export type ReadingLevelStats = {
  total: number;
  /** Same number as `completed` in the input — carried through under the name the stat cards use. */
  assessed: number;
  pending: number;
  completionPct: number;
  /** The rubric label nearest the mean rank of assessed learners, or `null` when there is nothing to average. */
  averageLabel: string | null;
};

/**
 * Pure monthly-reading-level math shared by the stat cards and its Vitest
 * coverage. No React, no server action.
 *
 * Rules:
 * - `assessed` is simply `completed` (the progress count the page/panel
 *   already computed server-side via `countMonthlyAssessmentProgress`) — this
 *   module never recounts it from `records`, so it can never disagree with
 *   the banner's own "X / Y learners assessed" figure.
 * - `pending = max(0, total - assessed)`, floored at zero so a `completed`
 *   that (through some transient state) exceeds `total` never reports a
 *   negative pending count.
 * - `completionPct = total > 0 ? clamp(round(assessed / total * 100), 0, 100) : 0`
 *   — never divides by zero, and clamped because `assessed` (= `completed`)
 *   can transiently exceed `total` for the same reason `pending` is floored
 *   above; without the clamp a stale `completed` would render as e.g. 167%.
 * - `averageLabel`: for each record, average whichever of
 *   `englishProfile`/`filipinoProfile` are set AND appear on this grade's
 *   rubric (`readingProfileOptionsForGrade`, index 0 = lowest) into one
 *   per-learner rank; values not on the grade's scale (e.g. a promoted
 *   learner's stale early-rubric value under a later grade) are ignored, not
 *   coerced. A record contributing no ranked value is skipped entirely. The
 *   per-learner ranks are then averaged across learners and rounded to the
 *   nearest scale index (`Math.round`, so a tie lands on the higher index,
 *   matching `Math.round`'s standard "round half up" behaviour) to pick a
 *   single rubric value, whose label is returned. With no ranked values at
 *   all, `averageLabel` is `null` — never `NaN`.
 */
export function computeReadingLevelStats({
  total,
  completed,
  records,
  gradeType,
}: ReadingLevelStatsInput): ReadingLevelStats {
  const assessed = completed;
  const pending = Math.max(0, total - assessed);
  const completionPct =
    total > 0
      ? Math.min(100, Math.max(0, Math.round((assessed / total) * 100)))
      : 0;

  const scale = readingProfileOptionsForGrade(gradeType).map((o) => o.value);
  const rankOf = new Map(scale.map((value, index) => [value, index]));

  const learnerRanks: number[] = [];
  for (const record of records) {
    const ranks: number[] = [];
    if (record.englishProfile != null && rankOf.has(record.englishProfile)) {
      ranks.push(rankOf.get(record.englishProfile)!);
    }
    if (record.filipinoProfile != null && rankOf.has(record.filipinoProfile)) {
      ranks.push(rankOf.get(record.filipinoProfile)!);
    }
    if (ranks.length === 0) continue;
    const mean = ranks.reduce((sum, r) => sum + r, 0) / ranks.length;
    learnerRanks.push(mean);
  }

  let averageLabel: string | null = null;
  if (learnerRanks.length > 0 && scale.length > 0) {
    const overallMean =
      learnerRanks.reduce((sum, r) => sum + r, 0) / learnerRanks.length;
    const index = Math.min(
      scale.length - 1,
      Math.max(0, Math.round(overallMean))
    );
    const value = scale[index];
    const option = readingProfileOptionsForGrade(gradeType).find(
      (o) => o.value === value
    );
    averageLabel = option?.label ?? null;
  }

  return { total, assessed, pending, completionPct, averageLabel };
}
