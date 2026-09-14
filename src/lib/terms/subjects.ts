/**
 * End of Terms sheet subjects — the pure half (no Prisma, no server-only).
 *
 * A school's subject list is per grade (`TermSubject`). Remove is archive
 * (`deletedAt`), so every reader must go through `orderSheetSubjects`, which
 * drops archived rows and fixes one display order. See
 * docs/superpowers/specs/2026-09-14-term-subjects-management-design.md §3.
 */
import {
  LEARNING_AREA_LABELS,
  LEARNING_AREA_ORDER,
} from "@/lib/constants/enum-labels";

export const MAX_ACTIVE_SUBJECTS_PER_GRADE = 15;

export type LegacyLearningArea = (typeof LEARNING_AREA_ORDER)[number];

/**
 * The 8 rows every grade starts with. Names must equal `LEARNING_AREA_LABELS`
 * and the M1 migration's seed, or the backfill join and lazy seed disagree.
 */
export const DEFAULT_TERM_SUBJECTS: ReadonlyArray<{
  legacyArea: LegacyLearningArea;
  name: string;
  position: number;
}> = LEARNING_AREA_ORDER.map((legacyArea, position) => ({
  legacyArea,
  name: LEARNING_AREA_LABELS[legacyArea],
  position,
}));

/** The key the active-name unique index compares on: `lower(btrim(name))`. */
export function subjectNameKey(name: string): string {
  return name.trim().toLowerCase();
}

type OrderableSubject = {
  id: string;
  name: string;
  position: number;
  deletedAt: Date | null;
};

/** Active rows only, by position, then name, then id. Never mutates. */
export function orderSheetSubjects<T extends OrderableSubject>(rows: readonly T[]): T[] {
  return rows
    .filter((r) => r.deletedAt === null)
    .sort(
      (a, b) =>
        a.position - b.position ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );
}

/** Max active position + 1, or 0 when nothing is active. */
export function nextPosition(
  rows: readonly { position: number; deletedAt: Date | null }[]
): number {
  let max = -1;
  for (const r of rows) {
    if (r.deletedAt === null && r.position > max) max = r.position;
  }
  return max + 1;
}

export type SubjectReorderPlan =
  | { ok: true; updates: { id: string; position: number }[] }
  | { ok: false; reason: "STALE" | "DUPLICATE" };

/**
 * `requestedIds` must be a permutation of `activeIds`. A repeated id is
 * DUPLICATE; a missing, extra or unknown id means the client's list is out of
 * date (STALE).
 */
export function planSubjectReorder(
  activeIds: readonly string[],
  requestedIds: readonly string[]
): SubjectReorderPlan {
  if (new Set(requestedIds).size !== requestedIds.length) {
    return { ok: false, reason: "DUPLICATE" };
  }
  const active = new Set(activeIds);
  if (
    requestedIds.length !== active.size ||
    requestedIds.some((id) => !active.has(id))
  ) {
    return { ok: false, reason: "STALE" };
  }
  return {
    ok: true,
    updates: requestedIds.map((id, position) => ({ id, position })),
  };
}
