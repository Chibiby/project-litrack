import { rollUp } from "@/lib/summary/shape/rollup";
import type {
  FacetRow,
  ScopeSchool,
  SummaryBucket,
  SummaryLevel,
  SummarySection,
} from "@/lib/summary/types";

/**
 * Bucket ids shared by every facet. Enum values are UPPER_SNAKE and none of
 * them uses these spellings.
 */
export const NOT_ANSWERED = "NOT_ANSWERED";
export const NOT_COLLECTED = "NOT_COLLECTED";
export const NO_RECORD = "NO_RECORD";
export const NOT_APPLICABLE = "NOT_APPLICABLE";

export const COMMON_BUCKET_LABELS: Record<string, string> = {
  [NOT_ANSWERED]: "Not answered",
  [NOT_COLLECTED]: "Not collected for this grade",
  [NO_RECORD]: "No record this month",
  [NOT_APPLICABLE]: "Not applicable",
};

/** `{ id, label }` in the order given, labelled from `labels` then the common ones. */
export function bucketsFrom(
  ids: readonly string[],
  labels: Readonly<Record<string, string>>
): SummaryBucket[] {
  return ids.map((id) => ({ id, label: labels[id] ?? COMMON_BUCKET_LABELS[id] ?? id }));
}

/**
 * Grade splits are shown at the overall and district levels. A by-school table
 * over many schools stays one row per school (per-grade detail for a school is
 * that school's own view), except when the scope is a single school.
 */
export function effectiveByGrade(
  byGrade: boolean,
  level: SummaryLevel,
  schools: readonly ScopeSchool[]
): boolean {
  return byGrade && (level !== "school" || schools.length === 1);
}

export function buildSection(args: {
  id: string;
  title: string;
  kind: SummarySection["kind"];
  byGrade: boolean;
  buckets: SummaryBucket[];
  rows: readonly FacetRow[];
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  baseLabel: string;
  baseRows?: readonly FacetRow[];
  note?: string;
  gradeBucketLabels?: Record<string, Record<string, string>>;
  overallLabel?: string;
}): SummarySection {
  const byGrade = effectiveByGrade(args.byGrade, args.level, args.schools);
  const section: SummarySection = {
    id: args.id,
    title: args.title,
    kind: args.kind,
    byGrade,
    buckets: args.buckets,
    baseLabel: args.baseLabel,
    table: rollUp(args.rows, args.schools, args.level, {
      byGrade,
      buckets: args.buckets.map((b) => b.id),
      baseRows: args.baseRows,
      overallLabel: args.overallLabel,
    }),
  };
  if (args.note) section.note = args.note;
  if (byGrade && args.gradeBucketLabels) section.gradeBucketLabels = args.gradeBucketLabels;
  return section;
}

/** Rows of one field. */
export function rowsOf(rows: readonly FacetRow[], field: string): FacetRow[] {
  return rows.filter((r) => r.field === field);
}
