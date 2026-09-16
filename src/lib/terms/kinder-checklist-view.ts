import {
  KINDER_COMPETENCY_COUNT,
  KINDER_COMPETENCY_ENTRIES_IN_ORDER,
  isKinderGradeType,
  type KinderCompetencyKey,
  type KinderCompetencyRatingCode,
} from "@/lib/terms/kinder-competencies";

/**
 * Pure, DB-free math for the Kindergarten End-of-Term competency checklist —
 * see docs/superpowers/specs/2026-09-16-kinder-end-of-term-checklist.md
 * section 9. No Prisma, no React, no `server-only`; follows
 * `src/lib/aral/reading-level-stats.ts` as its named precedent.
 */

export type KinderChecklistCellState = {
  t1Rating: KinderCompetencyRatingCode | null;
  t2Rating: KinderCompetencyRatingCode | null;
  t3Rating: KinderCompetencyRatingCode | null;
  remark: string | null;
};

const EMPTY_CELL: KinderChecklistCellState = {
  t1Rating: null,
  t2Rating: null,
  t3Rating: null,
  remark: null,
};

/**
 * Overlays saved rows onto the fixed 62-entry catalog: every key gets a
 * state, even one never saved (all-null). The returned map's key order
 * follows `KINDER_COMPETENCY_ENTRIES_IN_ORDER`, the catalog's own display
 * order, regardless of the input map's iteration order.
 */
export function mergeKinderChecklist(
  saved: ReadonlyMap<KinderCompetencyKey, KinderChecklistCellState>
): ReadonlyMap<KinderCompetencyKey, KinderChecklistCellState> {
  const merged = new Map<KinderCompetencyKey, KinderChecklistCellState>();
  for (const entry of KINDER_COMPETENCY_ENTRIES_IN_ORDER) {
    merged.set(entry.key, saved.get(entry.key) ?? EMPTY_CELL);
  }
  return merged;
}

export type KinderChecklistProgress = {
  touched: number;
  total: number;
  pct: number;
};

/**
 * How many of the 62 entries have at least one non-null rating across any
 * term — the hero's "N / 62 competencies" figure and its progress bar.
 *
 * "Touched" means any of `t1Rating`/`t2Rating`/`t3Rating` is set; a remark
 * alone does not count (owner decision, see spec section 9's Open Question 2).
 * `total` is always `KINDER_COMPETENCY_COUNT` (62), never the size of the
 * map handed in, so a caller that passes a partial map still reports against
 * the fixed catalog size rather than a shrunk denominator.
 */
export function countTouchedCompetencies(
  merged: ReadonlyMap<KinderCompetencyKey, KinderChecklistCellState>
): KinderChecklistProgress {
  let touched = 0;
  for (const cell of merged.values()) {
    if (cell.t1Rating !== null || cell.t2Rating !== null || cell.t3Rating !== null) {
      touched += 1;
    }
  }
  const total = KINDER_COMPETENCY_COUNT;
  const pct = total > 0 ? Math.min(100, Math.max(0, Math.round((touched / total) * 100))) : 0;
  return { touched, total, pct };
}

export type KinderGradeTypeSplit<T> = {
  kinder: T[];
  numeric: T[];
};

/**
 * Splits a set of advisory placements into the teacher's numeric vs Kinder
 * scopes — the one place section 3's split logic lives, shared by the
 * teacher page and the School Head page in section 10. Order within each
 * side is preserved from the input.
 */
export function splitByKinderGradeType<T extends { gradeType: string }>(
  placements: readonly T[]
): KinderGradeTypeSplit<T> {
  const kinder: T[] = [];
  const numeric: T[] = [];
  for (const placement of placements) {
    if (isKinderGradeType(placement.gradeType)) {
      kinder.push(placement);
    } else {
      numeric.push(placement);
    }
  }
  return { kinder, numeric };
}
