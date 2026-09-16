/**
 * End of Terms sheet subjects — the pure half (no Prisma, no server-only).
 *
 * A school's subject list is per grade (`TermSubject`). Remove is archive
 * (`deletedAt`), so every reader must go through `orderSheetSubjects`, which
 * drops archived rows and fixes one display order. See
 * docs/superpowers/specs/2026-09-14-term-subjects-management-design.md §3.
 */
import type { GradeLevelType } from "@prisma/client";
import {
  LEARNING_AREA_LABELS,
  LEARNING_AREA_ORDER,
} from "@/lib/constants/enum-labels";

export const MAX_ACTIVE_SUBJECTS_PER_GRADE = 15;

/**
 * Every `GradeLevelType` with a configurable, numeric End of Terms subjects
 * sheet — every value except:
 * - `FLOATING`, which has no advisory section and so no sheet at all (see
 *   `AdvisoryMode.FLOATING`);
 * - `KINDER`, whose End-of-Term report is the fixed DepEd competency
 *   checklist (`KINDER_COMPETENCY_CATALOG` in `kinder-competencies.ts`), not
 *   a School Head/Super Admin configurable subject list. Owner decision,
 *   2026-09: Kindergarten no longer participates in this machinery at all.
 *
 * Order matches the enum's own declaration in `prisma/schema.prisma`.
 *
 * Shared by the Super Admin default-subject validator (`gradeLevelType`
 * enum) and the Super Admin default-subjects page's grade-type picker.
 * `resetSchoolTermSubjects` filters `GradeLevel` rows directly (it needs live
 * grades, not grade types) but applies the same two exclusions.
 *
 * Existing `TermSubject`/`TermSubjectDefault` rows for Kindergarten (seeded
 * before this exclusion, e.g. release 1.18.3) are left in place — this list
 * only controls what new surfaces offer going forward.
 */
export const TERM_SHEET_GRADE_TYPES = [
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
] as const satisfies readonly GradeLevelType[];

/**
 * The message shown wherever a Floating grade's End of Terms subjects are
 * requested — `FLOATING` has no advisory section and no sheet at all (see
 * `AdvisoryMode.FLOATING`), so every entry point refuses it with this exact
 * sentence rather than a generic "not found".
 */
export const FLOATING_GRADE_MESSAGE =
  "Floating has no End of Terms sheet, so it has no subjects.";

/**
 * The message shown wherever Kindergarten's End of Terms subjects are
 * requested — Kindergarten's report is the fixed competency checklist, not a
 * configurable subject list (see `TERM_SHEET_GRADE_TYPES` above). Every
 * subject-management entry point refuses it with this exact sentence, the
 * same defense-in-depth shape as `FLOATING_GRADE_MESSAGE`: the UI should
 * never reach here, but every action re-checks anyway.
 */
export const KINDER_GRADE_MESSAGE =
  "Kindergarten uses the competency checklist, not term subjects.";

/**
 * A subject name's only character rule: no C0 controls or DEL. Trim/length
 * are separate Zod checks (`.trim().min(1).max(60)`) so each has its own
 * message; this is the one rule shared, byte-for-byte, between
 * `term-subject.schema.ts` (School Head's per-grade subjects) and
 * `term-subject-default.schema.ts` (Super Admin's per-type templates).
 */
export function isValidSubjectName(name: string): boolean {
  return ![...name].some((ch) => {
    const c = ch.codePointAt(0) ?? 0;
    return c < 32 || c === 127;
  });
}

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

export type SubjectResetDefault = { name: string };
export type SubjectResetExisting = { id: string; name: string; deletedAt: Date | null };

export type SubjectResetPlan = {
  /** An archived row whose name matches a default: bring it back at that default's position. */
  toRestore: { id: string; position: number }[];
  /** An already-active row whose name matches a default: pin it to that default's position. */
  toReposition: { id: string; position: number }[];
  /** A default with no matching row at all (active or archived): create it. */
  toCreate: { name: string; position: number }[];
  /** An active row matching no default: archive it. An already-archived row matching no default is left alone. */
  toArchive: string[];
}

/**
 * Plan a school-wide "Reset to default" for one grade: match `existing` rows
 * to `defaults` by `subjectNameKey` (case- and whitespace-insensitive, the
 * same comparison the SQL partial unique indexes use), and describe the
 * writes that bring the grade's sheet back to the template.
 *
 * Matching rules:
 * - `defaults` is already in display order; a matched row's new `position`
 *   is its index in `defaults`.
 * - An ACTIVE match is preferred over an ARCHIVED match with the same name —
 *   a default is never "restored" onto an archived row while an active row
 *   with that exact name already exists.
 * - A default with no match at all (active or archived) is created new.
 * - An active row matching no default is archived. An already-archived row
 *   matching no default is left untouched — archived rows only ever move
 *   when a default asks for them back.
 *
 * Pure: takes and returns plain data, no Prisma. The caller applies the plan
 * inside its own transaction and lock.
 */
export function planSubjectReset(
  defaults: readonly SubjectResetDefault[],
  existing: readonly SubjectResetExisting[]
): SubjectResetPlan {
  const activeByKey = new Map<string, SubjectResetExisting>();
  const archivedByKey = new Map<string, SubjectResetExisting>();
  for (const row of existing) {
    const key = subjectNameKey(row.name);
    if (row.deletedAt === null) {
      if (!activeByKey.has(key)) activeByKey.set(key, row);
    } else if (!archivedByKey.has(key)) {
      archivedByKey.set(key, row);
    }
  }

  const matchedIds = new Set<string>();
  const toRestore: { id: string; position: number }[] = [];
  const toReposition: { id: string; position: number }[] = [];
  const toCreate: { name: string; position: number }[] = [];

  defaults.forEach((d, position) => {
    const key = subjectNameKey(d.name);
    const active = activeByKey.get(key);
    if (active) {
      matchedIds.add(active.id);
      toReposition.push({ id: active.id, position });
      return;
    }
    const archived = archivedByKey.get(key);
    if (archived) {
      matchedIds.add(archived.id);
      toRestore.push({ id: archived.id, position });
      return;
    }
    toCreate.push({ name: d.name, position });
  });

  const toArchive = existing
    .filter((row) => row.deletedAt === null && !matchedIds.has(row.id))
    .map((row) => row.id);

  return { toRestore, toReposition, toCreate, toArchive };
}
