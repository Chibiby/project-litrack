import "server-only";
import { Prisma } from "@prisma/client";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { BOSY_TIER_LABELS, bosyTierOf, type BosyTier } from "@/lib/aral/bosy";
import { mosyRowStatus, type MosyRowStatus } from "@/lib/aral/mosy";
import { runSummaryQuery } from "@/lib/summary/queries/population";
import { buildExportRows, leadColumns } from "@/lib/summary/queries/aral";
import type { ScopedRaw } from "@/lib/summary/scoped-raw";
import { buildSection, bucketsFrom } from "@/lib/summary/shape/section";
import { rollUp } from "@/lib/summary/shape/rollup";
import type {
  FacetResult,
  FacetRow,
  ScopeSchool,
  SummaryBucket,
  SummaryLevel,
  SummaryList,
} from "@/lib/summary/types";

/**
 * Facets `bosy` and `mosy`: the division view of the teacher BOSY Report and
 * MOSY Report pages (`src/app/teacher/(app)/aral/{bosy,mosy}`).
 *
 * POPULATION: exactly the learners those pages list in their Super Admin
 * whole-school view (`mosyLearnerScope(null, schoolYearId)`): live, unarchived
 * learners of a school that has an active school year who are ARAL learners
 * now, or were moved out of ARAL through MOSY in that school year. So a school's
 * row here equals the "Total ARAL learners" card on its own pages.
 *
 * The SQL groups by the raw columns (grade type, ARAL flag, decision, reason,
 * Filipino BOSY level); every decision about which status, reason group or BOSY
 * tier a row lands in is made in pure TS here (`mosyStatusOfRow`,
 * `mosyReasonGroup`, `bosyTierOf`), the same functions the teacher pages use,
 * so the two can never disagree. Names are never read.
 *
 * TENANCY: no school filter in SQL (division-wide raw entry); `scopeRaw` fences.
 */

/**
 * `WITH scope`: one row per learner in the MOSY/BOSY population. `sy` is each
 * school's active school year (one per school; `DISTINCT ON` keeps one even if
 * a second were ever flagged active); `d` is the learner's MOSY decision row
 * for that year, if any.
 */
const SCOPE_CTE = Prisma.sql`
  WITH sy AS (
    SELECT DISTINCT ON ("schoolId") "id", "schoolId"
      FROM "SchoolYear" WHERE "isActive" = true
     ORDER BY "schoolId", "startDate" DESC, "id"
  ),
  scope AS (
    SELECT l."schoolId", g."type"::text AS gt, l."isAralLearner" AS is_aral,
           l."filipinoReadingProfile"::text AS filipino,
           (d."id" IS NOT NULL) AS has_row, d."decision"::text AS decision, d."reason"::text AS reason
      FROM "Learner" l
      JOIN sy ON sy."schoolId" = l."schoolId"
      JOIN "GradeLevel" g ON g."id" = l."gradeLevelId"
      LEFT JOIN "AralMosyDecision" d ON d."learnerId" = l."id" AND d."schoolYearId" = sy."id"
     WHERE l."deletedAt" IS NULL AND l."archivedAt" IS NULL
       AND (l."isAralLearner" = true OR d."decision" = 'MOVE_OUT')
  )`;

// ------------------------------------------------------------------ MOSY

export type RawMosyRow = {
  school_id: string;
  gt: string;
  is_aral: boolean;
  /** Whether a decision row exists for the active school year (a MOSY level was saved). */
  has_row: boolean;
  /** `AralMosyDecision.decision`, null when deferred or no row. */
  decision: string | null;
  /** `AralMosyDecision.reason`, set only on a MOVE_OUT. */
  reason: string | null;
  count: number;
};

export async function queryMosyRows(): Promise<RawMosyRow[]> {
  return runSummaryQuery<RawMosyRow>(Prisma.sql`${SCOPE_CTE}
    SELECT "schoolId" AS school_id, gt, is_aral, has_row, decision, reason, COUNT(*)::int AS count
      FROM scope GROUP BY 1, 2, 3, 4, 5, 6
  `);
}

/** The four MOSY statuses as disjoint buckets, in the order a decision moves through them. */
export const MOSY_SUMMARY_STATUSES = ["not_updated", "for_decision", "stay", "moved_out"] as const;

export const MOSY_SUMMARY_STATUS_LABELS: Record<MosyRowStatus, string> = {
  not_updated: "Not updated",
  for_decision: "Level saved, no decision yet",
  stay: "Stay in ARAL",
  moved_out: "Moved out",
};

/** A raw row's status: the teacher page's own `mosyRowStatus`. */
export function mosyStatusOfRow(r: Pick<RawMosyRow, "is_aral" | "has_row" | "decision">): MosyRowStatus {
  const decision = r.decision === "MOVE_OUT" || r.decision === "STAY" ? r.decision : null;
  return mosyRowStatus({ isAralLearner: r.is_aral, row: r.has_row ? { decision } : null });
}

/** Move-out reason groups. The two legacy "Improved to …" reasons fold into Improved reading level. */
export const MOSY_REASON_GROUPS = [
  "IMPROVED_READING_LEVEL",
  "DIAGNOSED_LSEN",
  "RECOMMENDED_LSEN_ASSESSMENT",
  "TRANSFERRED_OUT",
  "NLPA",
] as const;
export type MosyReasonGroup = (typeof MOSY_REASON_GROUPS)[number];

export const MOSY_REASON_GROUP_LABELS: Record<MosyReasonGroup, string> = {
  IMPROVED_READING_LEVEL: "Improved reading level",
  DIAGNOSED_LSEN: "Diagnosed LSEN",
  RECOMMENDED_LSEN_ASSESSMENT: "Recommended for LSEN assessment",
  TRANSFERRED_OUT: "Transferred out",
  NLPA: "NLPA",
};

/** Reason group of a moved-out row; null for a reason this facet does not know (counted as moved out only). */
export function mosyReasonGroup(reason: string | null): MosyReasonGroup | null {
  if (reason === "IMPROVED_EARLY_GRADES" || reason === "IMPROVED_UPPER_GRADES") {
    return "IMPROVED_READING_LEVEL";
  }
  return (MOSY_REASON_GROUPS as readonly string[]).includes(reason ?? "")
    ? (reason as MosyReasonGroup)
    : null;
}

/** Facet rows: one `status` row per raw row, plus a `reason` row for each moved-out one. */
export function mosyFacetRows(raw: readonly RawMosyRow[]): FacetRow[] {
  const out: FacetRow[] = [];
  for (const r of raw) {
    const count = Number(r.count);
    const status = mosyStatusOfRow(r);
    out.push({ schoolId: r.school_id, gradeType: r.gt, field: "status", bucket: status, count });
    if (status === "moved_out") {
      const group = mosyReasonGroup(r.reason);
      if (group) out.push({ schoolId: r.school_id, gradeType: r.gt, field: "reason", bucket: group, count });
    }
  }
  return out;
}

// ------------------------------------------------------------------ BOSY

export type RawBosyRow = {
  school_id: string;
  gt: string;
  /** `Learner.filipinoReadingProfile`: the Filipino level recorded at enrolment. */
  filipino: string | null;
  count: number;
};

export async function queryBosyRows(): Promise<RawBosyRow[]> {
  return runSummaryQuery<RawBosyRow>(Prisma.sql`${SCOPE_CTE}
    SELECT "schoolId" AS school_id, gt, filipino, COUNT(*)::int AS count
      FROM scope GROUP BY 1, 2, 3
  `);
}

export const BOSY_SUMMARY_TIERS = ["tier1", "tier2", "tier3", "tier4"] as const satisfies readonly BosyTier[];
/** A BOSY level in none of the four groups (no current value is; kept so a count never vanishes). */
export const BOSY_OTHER = "OTHER";

export function bosyFacetRows(raw: readonly RawBosyRow[]): FacetRow[] {
  return raw.map((r) => ({
    schoolId: r.school_id,
    gradeType: r.gt,
    field: "tier",
    bucket: bosyTierOf(r.filipino) ?? BOSY_OTHER,
    count: Number(r.count),
  }));
}

// ------------------------------------------------------------------ shared

const GRADE_ORDER = Object.keys(GRADE_LEVEL_LABELS);

/** Grade types with a non-zero row in `rows`, in enum order (unknown types last). */
function presentGrades(rows: readonly FacetRow[]): string[] {
  const seen = new Set(rows.filter((r) => r.count > 0 && r.gradeType).map((r) => r.gradeType as string));
  const rank = (g: string) => (GRADE_ORDER.includes(g) ? GRADE_ORDER.indexOf(g) : GRADE_ORDER.length);
  return [...seen].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function gradeLabel(g: string): string {
  return GRADE_LEVEL_LABELS[g] ?? g;
}

/**
 * Per-grade counts for the export at any level: the rows re-keyed to
 * `<grade>|<bucket>` and rolled up without the grade split, so a by-school
 * export still carries every school's per-grade figures.
 */
function perGradeTable(
  rows: readonly FacetRow[],
  schools: readonly ScopeSchool[],
  level: SummaryLevel,
  grades: readonly string[],
  buckets: readonly string[]
) {
  const keyed = rows.map((r) => ({ ...r, gradeType: null, bucket: `${r.gradeType}|${r.bucket}` }));
  const ids = grades.flatMap((g) => buckets.map((b) => `${g}|${b}`));
  const table = rollUp(keyed, schools, level, { byGrade: false, buckets: ids });
  return new Map(table.groups.map((g) => [g.key, g]));
}

const SCOPE_NOTE =
  "ARAL learners in each school's active school year, including learners moved out of ARAL through MOSY this school year: the same learners as the school's own MOSY Report and BOSY Report pages.";

// ------------------------------------------------------------------ MOSY shape

export function shapeMosy(args: {
  raw: ScopedRaw<RawMosyRow>;
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  computedAt: string;
}): FacetResult {
  const { schools, level } = args;
  const rows = mosyFacetRows(args.raw);
  const statusRows = rows.filter((r) => r.field === "status");
  const reasonRows = rows.filter((r) => r.field === "reason");
  const common = { schools, level, byGrade: true };

  const statusSection = buildSection({
    ...common,
    id: "status",
    title: "MOSY status",
    kind: "single",
    buckets: bucketsFrom(MOSY_SUMMARY_STATUSES, MOSY_SUMMARY_STATUS_LABELS),
    rows: statusRows,
    baseLabel: "% of MOSY learners",
    note: "Not updated: no MOSY reading level saved yet. Level saved, no decision yet: a level is saved but the learner is not yet marked to stay or move out (on the teacher's page both count as For MOSY decision).",
  });
  const reasonSection = buildSection({
    ...common,
    id: "movedOutByReason",
    title: "Moved out of ARAL, by reason",
    kind: "single",
    buckets: bucketsFrom(MOSY_REASON_GROUPS, {
      ...MOSY_REASON_GROUP_LABELS,
      NLPA: "No longer participating in learning activities (NLPA)",
      DIAGNOSED_LSEN: "Diagnosed as LSEN",
    }),
    rows: reasonRows,
    baseLabel: "% of learners moved out",
    note: "Improved reading level includes every \"Improved to …\" level, and reasons saved before levels were listed one by one.",
  });

  return {
    facetId: "mosy",
    title: "MOSY",
    subtitle: "Middle of school year decisions for ARAL learners in the active school year",
    level,
    params: { level },
    schoolCount: schools.length,
    notes: [SCOPE_NOTE, "Names are not included."],
    gaps: [],
    sections: [statusSection, reasonSection],
    lists: [],
    exportList: mosyExportList({ schools, level, statusRows, reasonRows }),
    computedAt: args.computedAt,
  };
}

/** Per-grade statuses the export reads: stay and moved out are printed; all four sum to the grade's learners. */
const PER_GRADE_STATUS_ORDER = ["stay", "moved_out", "not_updated", "for_decision"] as const;

/**
 * MOSY export: one row per school (district, scope). Counts first: MOSY
 * learners, the four statuses, the five move-out reasons; then per grade the
 * learners, stay and moved-out counts.
 */
function mosyExportList(args: {
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  statusRows: readonly FacetRow[];
  reasonRows: readonly FacetRow[];
}): SummaryList {
  const { schools, level, statusRows, reasonRows } = args;
  // The level groups without the grade split (the section's own groups carry
  // per-grade rows at overall and district level).
  const statusTable = rollUp(statusRows, schools, level, { byGrade: false, buckets: MOSY_SUMMARY_STATUSES });
  const reasonByKey = new Map(
    rollUp(reasonRows, schools, level, { byGrade: false, buckets: MOSY_REASON_GROUPS }).groups.map((g) => [g.key, g])
  );
  const grades = presentGrades(statusRows);
  const perGrade = perGradeTable(statusRows, schools, level, grades, PER_GRADE_STATUS_ORDER);
  const lead = leadColumns(level);
  const firstGrade = lead.length + 1 + MOSY_SUMMARY_STATUSES.length + MOSY_REASON_GROUPS.length;

  return {
    id: "mosy-per-school",
    title: "MOSY",
    note: "Level saved, no decision yet: a MOSY level is saved but the learner is not yet marked to stay or move out. Grade columns follow each learner's current grade.",
    columns: [
      ...lead,
      "MOSY learners",
      ...MOSY_SUMMARY_STATUSES.map((s) => MOSY_SUMMARY_STATUS_LABELS[s]),
      ...MOSY_REASON_GROUPS.map((r) => `Moved out: ${MOSY_REASON_GROUP_LABELS[r]}`),
      ...grades.flatMap((g) => {
        const label = gradeLabel(g);
        return [`${label} learners`, `${label} stay`, `${label} moved out`];
      }),
    ],
    groups: grades.map((g, i) => ({ label: gradeLabel(g), start: firstGrade + i * 3, count: 3 })),
    rows: buildExportRows({
      schools,
      level,
      groups: statusTable.groups,
      // [...statuses, ...reasons, ...per grade (stay, moved out, not updated, for decision)]
      rowNumbers: (key) => {
        const s = statusTable.groups.find((g) => g.key === key);
        const r = reasonByKey.get(key);
        const pg = perGrade.get(key);
        return [
          ...MOSY_SUMMARY_STATUSES.map((b) => s?.cells[b]?.count ?? 0),
          ...MOSY_REASON_GROUPS.map((b) => r?.cells[b]?.count ?? 0),
          ...grades.flatMap((g) =>
            PER_GRADE_STATUS_ORDER.map((b) => pg?.cells[`${g}|${b}`]?.count ?? 0)
          ),
        ];
      },
      figures: (n) => {
        const statuses = n.slice(0, MOSY_SUMMARY_STATUSES.length);
        const reasons = n.slice(MOSY_SUMMARY_STATUSES.length, MOSY_SUMMARY_STATUSES.length + MOSY_REASON_GROUPS.length);
        const gradeNums = n.slice(MOSY_SUMMARY_STATUSES.length + MOSY_REASON_GROUPS.length);
        const total = statuses.reduce((a, b) => a + b, 0);
        return [
          total,
          ...statuses,
          ...reasons,
          ...grades.flatMap((_, i) => {
            const [stay = 0, out = 0, notUpdated = 0, forDecision = 0] = gradeNums.slice(i * 4, i * 4 + 4);
            return [stay + out + notUpdated + forDecision, stay, out];
          }),
        ];
      },
    }),
  };
}

// ------------------------------------------------------------------ BOSY shape

export function shapeBosy(args: {
  raw: ScopedRaw<RawBosyRow>;
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  computedAt: string;
}): FacetResult {
  const { schools, level } = args;
  const rows = bosyFacetRows(args.raw);
  const hasOther = rows.some((r) => r.bucket === BOSY_OTHER && r.count > 0);
  const bucketIds = [...BOSY_SUMMARY_TIERS, ...(hasOther ? [BOSY_OTHER] : [])];

  const tierSection = buildSection({
    schools,
    level,
    byGrade: true,
    id: "bosyLevel",
    title: "BOSY reading level (Filipino)",
    kind: "single",
    buckets: bucketsFrom(bucketIds, { ...BOSY_TIER_LABELS, [BOSY_OTHER]: "Other level" }),
    rows,
    baseLabel: "% of ARAL learners",
    note: "Groups follow the Filipino level recorded at enrolment. Low Emergent: Non-Decoder / Low Emergent, or Level 0. High Emergent: Frustration / High Emergent, or Level 1. Developing: Instructional, Developing or Transitioning, or Level 2. Grade Ready: Independent / Grade Ready, or Level 3.",
  });

  return {
    facetId: "bosy",
    title: "BOSY",
    subtitle: "Beginning of school year reading levels of ARAL learners in the active school year",
    level,
    params: { level },
    schoolCount: schools.length,
    notes: [SCOPE_NOTE, "Names are not included."],
    gaps: [],
    sections: [tierSection],
    lists: [],
    exportList: bosyExportList({ schools, level, rows, bucketIds, tierBuckets: tierSection.buckets }),
    computedAt: args.computedAt,
  };
}

/**
 * BOSY export: one row per school (district, scope). Counts first: ARAL
 * learners and the four BOSY groups; then per grade the learners and the four
 * groups.
 */
function bosyExportList(args: {
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  rows: readonly FacetRow[];
  bucketIds: readonly string[];
  tierBuckets: readonly SummaryBucket[];
}): SummaryList {
  const { schools, level, rows, bucketIds, tierBuckets } = args;
  const table = rollUp(rows, schools, level, { byGrade: false, buckets: bucketIds });
  const grades = presentGrades(rows);
  const perGrade = perGradeTable(rows, schools, level, grades, bucketIds);
  const lead = leadColumns(level);
  const tierLabels = BOSY_SUMMARY_TIERS.map((t) => BOSY_TIER_LABELS[t]);
  const perGradeCount = 1 + BOSY_SUMMARY_TIERS.length;
  const firstGrade = lead.length + 1 + tierBuckets.length;

  return {
    id: "bosy-per-school",
    title: "BOSY",
    note: "Groups follow the Filipino level recorded at enrolment. Grade columns follow each learner's current grade.",
    columns: [
      ...lead,
      "ARAL learners",
      ...tierBuckets.map((b) => b.label),
      ...grades.flatMap((g) => {
        const label = gradeLabel(g);
        return [`${label} learners`, ...tierLabels.map((t) => `${label} ${t}`)];
      }),
    ],
    groups: grades.map((g, i) => ({ label: gradeLabel(g), start: firstGrade + i * perGradeCount, count: perGradeCount })),
    rows: buildExportRows({
      schools,
      level,
      groups: table.groups,
      // [...buckets, ...per grade buckets]
      rowNumbers: (key) => {
        const t = table.groups.find((g) => g.key === key);
        const pg = perGrade.get(key);
        return [
          ...bucketIds.map((b) => t?.cells[b]?.count ?? 0),
          ...grades.flatMap((g) => bucketIds.map((b) => pg?.cells[`${g}|${b}`]?.count ?? 0)),
        ];
      },
      figures: (n) => {
        const k = bucketIds.length;
        const top = n.slice(0, k);
        const gradeNums = n.slice(k);
        return [
          top.reduce((a, b) => a + b, 0),
          ...top,
          ...grades.flatMap((_, i) => {
            const g = gradeNums.slice(i * k, i * k + k);
            return [g.reduce((a, b) => a + b, 0), ...g.slice(0, BOSY_SUMMARY_TIERS.length)];
          }),
        ];
      },
    }),
  };
}
