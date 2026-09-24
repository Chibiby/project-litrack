/**
 * Shapes shared by every summary facet (docs/specs/district-admin.md 3.6).
 *
 * Pure types, client-safe: the summary UI imports these to render what a
 * facet's `load` returned. Everything here is plain JSON, because a facet
 * result lives in the Data Cache (`cachedQuery`) between requests.
 */

export const SUMMARY_FACET_IDS = [
  "learners",
  "reading-behavior",
  "end-of-term",
  "attendance",
  "reading-levels",
  "compliance",
  "profiling",
] as const;

export type SummaryFacetId = (typeof SUMMARY_FACET_IDS)[number];

/** Which rows a summary table has: one for the whole scope, one per district, or one per school. */
export const SUMMARY_LEVELS = ["overall", "district", "school"] as const;
export type SummaryLevel = (typeof SUMMARY_LEVELS)[number];

/** One school a scope covers, as `resolveScopeSchools` returns it. */
export type ScopeSchool = {
  id: string;
  name: string;
  schoolIdCode: string;
  district: string | null;
  division: string | null;
  region: string | null;
  isActive: boolean;
};

/**
 * One count at the finest grain a facet's SQL returns.
 *
 * `gradeType` is the `GradeLevel.type` of the learner's CURRENT grade, or null
 * for a facet that does not split by grade. `base`, when set, is this row's own
 * denominator (a per-bucket base: scores recorded in one subject, possible
 * attendance marks in one week). `sum` carries a total to average over `base`.
 */
export type FacetRow = {
  schoolId: string;
  gradeType: string | null;
  field: string;
  bucket: string;
  count: number;
  base?: number;
  sum?: number;
};

export type SummaryCell = {
  count: number;
  base: number;
  /** `pct(count, base)`: one decimal, null when `base` is 0. */
  pct: number | null;
  /** Average of `sum` over `base`, one decimal. Only on sections that carry sums (end-of-term). */
  mean?: number | null;
};

export type SummaryGroup = {
  /** Stable key: `overall`, `district:<name>`, `school:<id>`, plus `|<gradeType>` when split by grade. */
  key: string;
  /** "All schools", the district name, or the school name. */
  label: string;
  /** Set when `level` is `school`. */
  schoolId?: string;
  /** Set when `level` is `district` or `school`; null means "No district". */
  district?: string | null;
  /** Set on a per-grade row; null on the row that totals every grade. */
  gradeType?: string | null;
  /** "Grade 3", or "All grades" on the total row. Only on tables split by grade. */
  gradeLabel?: string;
  /** The row's population: what a single-choice row's percentages add up over. */
  base: number;
  /** Every bucket the section lists, zero-filled. */
  cells: Record<string, SummaryCell>;
};

export type SummaryTable = { groups: SummaryGroup[] };

export type SummaryBucket = { id: string; label: string };

/**
 * One table on a facet page.
 *
 * - `single`: a row's percentages add up to 100% across its buckets (every
 *   member lands in exactly one, "Not answered" included).
 * - `multi`: a member may be in several buckets; the row does not add up to 100
 *   and `baseLabel` says so.
 * - `rate`: every cell is its own rate with its own base (attendance per week).
 * - `average`: every cell has its own base and a `mean` (end-of-term subjects).
 */
export type SummarySection = {
  id: string;
  title: string;
  kind: "single" | "multi" | "rate" | "average";
  byGrade: boolean;
  /** Column order and default labels. */
  buckets: SummaryBucket[];
  /**
   * Per-grade label overrides, keyed by grade type then bucket id. Reading
   * profiles read "Low Emergent" in Grade 3 and "Non-decoder" in Grade 5; the
   * "All grades" row uses `buckets[].label`.
   */
  gradeBucketLabels?: Record<string, Record<string, string>>;
  /** What the percentage is of, e.g. "% of learners in the grade". */
  baseLabel: string;
  note?: string;
  table: SummaryTable;
};

/** A plain list printed alongside the tables (schools flagged, schools with no attendance). */
export type SummaryList = {
  id: string;
  title: string;
  note?: string;
  columns: string[];
  rows: (string | number | null)[][];
};

export type FacetResult = {
  facetId: SummaryFacetId;
  title: string;
  /** One line under the title: the population and the period. */
  subtitle: string;
  level: SummaryLevel;
  /** The params the facet actually used, defaults filled in. */
  params: Record<string, string | null>;
  /** How many schools the scope covers (active ones only, for compliance). */
  schoolCount: number;
  /** Explanations the page shows (how a figure is defined). */
  notes: string[];
  /** Items the DOCX asks for that no field backs (spec 4, GAP rows). */
  gaps: string[];
  sections: SummarySection[];
  lists: SummaryList[];
  /** Choices for the facet's own selects, e.g. `schoolYearLabels` for end-of-term. */
  options?: Record<string, string[]>;
  /** ISO instant the figures were computed, for "Figures as of HH:MM". */
  computedAt: string;
};
