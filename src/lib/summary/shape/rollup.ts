import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { mean, pct } from "@/lib/summary/shape/pct";
import type {
  FacetRow,
  ScopeSchool,
  SummaryCell,
  SummaryGroup,
  SummaryLevel,
  SummaryTable,
} from "@/lib/summary/types";

/**
 * The pure roll-up every summary table goes through (spec 3.6, invariant I17).
 *
 * A facet's SQL returns counts per school (and grade); this sums them to the
 * whole scope, to each district, or keeps them per school. Because every level
 * is a sum of the same school-grain rows, the overall row always equals the sum
 * of the district rows and the sum of the school rows.
 *
 * Rows for a school that is not in `schools` are dropped. The SQL is already
 * scoped to those schools' ids, so this is a second fence, not the first.
 */

export type RollUpOptions = {
  /** Split each level row into one row per grade, plus an "All grades" total. */
  byGrade: boolean;
  /** Bucket ids to list (zero-filled), in column order. */
  buckets: readonly string[];
  /**
   * Multi-select sections: rows whose summed `count` is each group's base (the
   * population). Omitted for single-choice sections, where a group's own rows
   * sum to its base because every member lands in exactly one bucket.
   */
  baseRows?: readonly FacetRow[];
  /** Label of the single overall row. */
  overallLabel?: string;
};

export const NO_DISTRICT_LABEL = "No district";
export const ALL_GRADES_LABEL = "All grades";

const GRADE_ORDER = Object.keys(GRADE_LEVEL_LABELS);

function gradeRank(type: string): number {
  const i = GRADE_ORDER.indexOf(type);
  return i === -1 ? GRADE_ORDER.length : i;
}

type LevelRow = {
  key: string;
  label: string;
  schoolId?: string;
  district?: string | null;
};

function levelRows(
  schools: readonly ScopeSchool[],
  level: SummaryLevel,
  overallLabel: string
): { rows: LevelRow[]; keyOf: Map<string, string> } {
  const keyOf = new Map<string, string>();
  if (level === "overall") {
    for (const s of schools) keyOf.set(s.id, "overall");
    return { rows: [{ key: "overall", label: overallLabel }], keyOf };
  }
  if (level === "district") {
    const districts = new Set<string | null>();
    for (const s of schools) {
      districts.add(s.district);
      keyOf.set(s.id, districtKey(s.district));
    }
    const named = [...districts].filter((d): d is string => d !== null).sort();
    const rows: LevelRow[] = named.map((d) => ({ key: districtKey(d), label: d, district: d }));
    if (districts.has(null)) {
      rows.push({ key: districtKey(null), label: NO_DISTRICT_LABEL, district: null });
    }
    return { rows, keyOf };
  }
  const sorted = [...schools].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  );
  for (const s of sorted) keyOf.set(s.id, `school:${s.id}`);
  return {
    rows: sorted.map((s) => ({
      key: `school:${s.id}`,
      label: s.name,
      schoolId: s.id,
      district: s.district,
    })),
    keyOf,
  };
}

function districtKey(district: string | null): string {
  return district === null ? "district:" : `district:${JSON.stringify(district)}`;
}

type Acc = { base: number; cells: Map<string, { count: number; base: number; sum: number }> };

function emptyAcc(): Acc {
  return { base: 0, cells: new Map() };
}

export function rollUp(
  rows: readonly FacetRow[],
  schools: readonly ScopeSchool[],
  level: SummaryLevel,
  opts: RollUpOptions
): SummaryTable {
  const { rows: levels, keyOf } = levelRows(schools, level, opts.overallLabel ?? "All schools");
  const perCellBase = rows.some((r) => r.base !== undefined);
  const hasSums = rows.some((r) => r.sum !== undefined);

  // groupKey -> accumulator; gradeKey "" is the all-grades total.
  const accs = new Map<string, Map<string, Acc>>();
  function accFor(levelKey: string, gradeKey: string): Acc {
    let byGrade = accs.get(levelKey);
    if (!byGrade) {
      byGrade = new Map();
      accs.set(levelKey, byGrade);
    }
    let acc = byGrade.get(gradeKey);
    if (!acc) {
      acc = emptyAcc();
      byGrade.set(gradeKey, acc);
    }
    return acc;
  }
  function targets(row: FacetRow): Acc[] | null {
    const levelKey = keyOf.get(row.schoolId);
    if (levelKey === undefined) return null;
    const out = [accFor(levelKey, "")];
    if (opts.byGrade && row.gradeType) out.push(accFor(levelKey, row.gradeType));
    return out;
  }

  for (const row of rows) {
    const accsForRow = targets(row);
    if (!accsForRow) continue;
    for (const acc of accsForRow) {
      const cell = acc.cells.get(row.bucket) ?? { count: 0, base: 0, sum: 0 };
      cell.count += row.count;
      cell.base += row.base ?? 0;
      cell.sum += row.sum ?? 0;
      acc.cells.set(row.bucket, cell);
      if (!opts.baseRows) acc.base += perCellBase ? (row.base ?? 0) : row.count;
    }
  }
  if (opts.baseRows) {
    for (const row of opts.baseRows) {
      const accsForRow = targets(row);
      if (!accsForRow) continue;
      for (const acc of accsForRow) acc.base += row.count;
    }
  }

  const bucketIds = [...opts.buckets];
  function toGroup(
    lr: LevelRow,
    gradeKey: string,
    acc: Acc
  ): SummaryGroup {
    const ids = [...bucketIds];
    for (const id of acc.cells.keys()) if (!ids.includes(id)) ids.push(id);
    const cells: Record<string, SummaryCell> = {};
    for (const id of ids) {
      const c = acc.cells.get(id) ?? { count: 0, base: 0, sum: 0 };
      const base = perCellBase ? c.base : acc.base;
      const cell: SummaryCell = { count: c.count, base, pct: pct(c.count, base) };
      if (hasSums) cell.mean = mean(c.sum, base);
      cells[id] = cell;
    }
    const group: SummaryGroup = {
      key: gradeKey ? `${lr.key}|${gradeKey}` : lr.key,
      label: lr.label,
      base: acc.base,
      cells,
    };
    if (lr.schoolId !== undefined) group.schoolId = lr.schoolId;
    if (lr.district !== undefined) group.district = lr.district;
    if (opts.byGrade) {
      group.gradeType = gradeKey || null;
      group.gradeLabel = gradeKey ? (GRADE_LEVEL_LABELS[gradeKey] ?? gradeKey) : ALL_GRADES_LABEL;
    }
    return group;
  }

  const groups: SummaryGroup[] = [];
  for (const lr of levels) {
    const byGrade = accs.get(lr.key);
    if (opts.byGrade && byGrade) {
      const grades = [...byGrade.keys()]
        .filter((g) => g !== "")
        .sort((a, b) => gradeRank(a) - gradeRank(b) || a.localeCompare(b));
      for (const g of grades) groups.push(toGroup(lr, g, byGrade.get(g)!));
    }
    groups.push(toGroup(lr, "", byGrade?.get("") ?? emptyAcc()));
  }
  return { groups };
}

/** The cell for `bucketId`, zero-filled if the group never saw it. */
export function cellOf(group: SummaryGroup, bucketId: string): SummaryCell {
  return group.cells[bucketId] ?? { count: 0, base: group.base, pct: pct(0, group.base) };
}
