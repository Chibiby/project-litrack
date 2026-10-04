import "server-only";
import { Prisma } from "@prisma/client";
import {
  LEARNING_AREA_ORDER,
  TERM_MARK_LABELS,
  TERM_MARK_SHORT_LABELS,
  TERM_PERIOD_LABELS,
} from "@/lib/constants/enum-labels";
import { populationCte, runSummaryQuery } from "@/lib/summary/queries/population";
import type { ScopedRaw } from "@/lib/summary/scoped-raw";
import { buildSection } from "@/lib/summary/shape/section";
import { subjectKey, subjectLabel } from "@/lib/summary/shape/subject-key";
import type {
  FacetResult,
  FacetRow,
  ScopeSchool,
  SummaryLevel,
  SummarySection,
} from "@/lib/summary/types";

/**
 * Facet `end-of-term` (spec 4.3): average per subject and learners scoring 80+
 * for one school-year label and term; Grade 1's letter marks as a distribution
 * (Q7 default).
 *
 * `TermGrade` has no `schoolId`: grades count toward the learner's CURRENT
 * school. The school-year label is the key shared across schools, since each
 * school has its own `SchoolYear` rows. With no label given, the label most
 * schools in scope have active is used (Q15 default); all three terms come
 * back so the latest term with grades can be chosen without a second query.
 *
 * The SQL runs over every school and is cached once for the division, so it
 * cannot know the scope's default label. It returns one `label` row per
 * (school, school-year label) with `n` = how many of that school's
 * `SchoolYear` rows with that label are active, plus grades for every
 * candidate label (the requested one, else every label active anywhere), each
 * row carrying its `label`. `schoolYearLabelChoice` then picks the default
 * and the picker options from the rows `scopeRaw` kept, exactly as the old
 * per-scope SQL did.
 */
export type RawTermRow = {
  kind: "label" | "score" | "mark";
  school_id: string | null;
  gt: string | null;
  term: string | null;
  legacy_area: string | null;
  subject_name: string | null;
  legacy_subject: string | null;
  /** `label` rows: the school-year label. `mark` rows: the mark. */
  bucket: string | null;
  /** The school-year label of the row (the grade's year for score/mark rows). */
  label: string | null;
  /** `label` rows: how many of the school's `SchoolYear` rows with this label are active. */
  n: number;
  total: number;
  n80: number;
};

export async function queryEndOfTermRows(schoolYearLabel: string | null): Promise<RawTermRow[]> {
  return runSummaryQuery<RawTermRow>(Prisma.sql`
    WITH pop AS (${populationCte({ aral: false })}),
    lbl AS (
      SELECT DISTINCT s2."label" FROM "SchoolYear" s2
      WHERE (${schoolYearLabel}::text IS NULL AND s2."isActive" = true)
         OR s2."label" = ${schoolYearLabel}::text
    ),
    g AS (
      SELECT p."schoolId", p.gt, sy."label", tg."term"::text AS term,
             ts."legacyArea"::text AS legacy_area, ts."name" AS subject_name,
             tg."subject"::text AS legacy_subject, tg."score", tg."mark"::text AS mark
      FROM "TermGrade" tg
      JOIN pop p ON p."id" = tg."learnerId"
      JOIN "SchoolYear" sy ON sy."id" = tg."schoolYearId"
      LEFT JOIN "TermSubject" ts ON ts."id" = tg."termSubjectId"
      WHERE sy."label" IN (SELECT "label" FROM lbl)
        AND (tg."termSubjectId" IS NULL OR ts."deletedAt" IS NULL)
    )
    SELECT 'label'::text AS kind, sy."schoolId" AS school_id, NULL::text AS gt, NULL::text AS term,
           NULL::text AS legacy_area, NULL::text AS subject_name, NULL::text AS legacy_subject,
           sy."label" AS bucket, sy."label" AS label,
           (COUNT(*) FILTER (WHERE sy."isActive" = true))::int AS n, 0 AS total, 0 AS n80
      FROM "SchoolYear" sy GROUP BY sy."schoolId", sy."label"
    UNION ALL
    SELECT 'score', "schoolId", gt, term, legacy_area, subject_name, legacy_subject, NULL, "label",
           COUNT(*)::int, SUM("score")::int, (COUNT(*) FILTER (WHERE "score" >= 80))::int
      FROM g WHERE "score" IS NOT NULL GROUP BY 2, 3, 4, 5, 6, 7, 9
    UNION ALL
    SELECT 'mark', "schoolId", gt, term, legacy_area, subject_name, legacy_subject, mark, "label",
           COUNT(*)::int, 0, 0
      FROM g WHERE mark IS NOT NULL GROUP BY 2, 3, 4, 5, 6, 7, 8, 9
  `);
}

/** Postgres `ORDER BY label DESC` for the labels this app writes ("2026-2027"). */
function compareLabelDesc(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
}

/**
 * The school-year picker and the label shown, from the scope's own `label`
 * rows (already through `scopeRaw`).
 *
 * - options: every label any scoped school has, newest first (`sort().reverse()`).
 * - selected: the requested label; else the label with the most ACTIVE
 *   `SchoolYear` rows across the scope, ties to the higher label, i.e. the old
 *   `ORDER BY COUNT(*) DESC, sy."label" DESC LIMIT 1`; null when none is active.
 */
export function schoolYearLabelChoice(
  raw: ScopedRaw<RawTermRow>,
  requested: string | null
): { options: string[]; selected: string | null } {
  const all = new Set<string>();
  const active = new Map<string, number>();
  for (const r of raw) {
    if (r.kind !== "label" || !r.bucket) continue;
    all.add(r.bucket);
    if (Number(r.n) > 0) active.set(r.bucket, (active.get(r.bucket) ?? 0) + Number(r.n));
  }
  const options = [...all].sort().reverse();
  if (requested !== null) return { options, selected: requested };
  const ranked = [...active.entries()].sort(
    ([la, na], [lb, nb]) => nb - na || compareLabelDesc(la, lb)
  );
  return { options, selected: ranked[0]?.[0] ?? null };
}

const TERM_ORDER = ["FIRST", "SECOND", "THIRD"] as const;
const MARK_ORDER = ["ADVANCING", "BENCHMARKING", "CONNECTING", "DEVELOPING", "EMERGING"] as const;

/** The term to show: the requested one, else the latest term with any grade, else the first. */
export function pickTerm(raw: readonly RawTermRow[], requested: string | null): string {
  if (requested) return requested;
  const withData = new Set(
    raw.filter((r) => (r.kind === "score" || r.kind === "mark") && r.term).map((r) => r.term!)
  );
  for (let i = TERM_ORDER.length - 1; i >= 0; i--) {
    if (withData.has(TERM_ORDER[i]!)) return TERM_ORDER[i]!;
  }
  return "FIRST";
}

function subjectOrder(a: string, b: string, labels: Map<string, string>): number {
  const rank = (k: string) => {
    if (!k.startsWith("area:")) return LEARNING_AREA_ORDER.length;
    const i = (LEARNING_AREA_ORDER as readonly string[]).indexOf(k.slice(5));
    return i === -1 ? LEARNING_AREA_ORDER.length : i;
  };
  return rank(a) - rank(b) || (labels.get(a) ?? a).localeCompare(labels.get(b) ?? b);
}

export function shapeEndOfTerm(args: {
  raw: ScopedRaw<RawTermRow>;
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  requestedLabel: string | null;
  requestedTerm: string | null;
  computedAt: string;
}): FacetResult {
  const { schools, level } = args;
  const { options: labels, selected: schoolYearLabel } = schoolYearLabelChoice(
    args.raw,
    args.requestedLabel
  );
  // Grades of the shown school year only (the raw holds every candidate year).
  const raw = args.raw.filter(
    (r) => (r.kind === "score" || r.kind === "mark") && r.label !== null && r.label === schoolYearLabel
  );
  const term = pickTerm(raw, args.requestedTerm);

  // Kinder keeps a competency checklist, not subject grades.
  const inTerm = raw.filter((r) => r.term === term && r.gt !== "KINDER" && r.school_id);

  const spellings = new Map<string, Map<string, number>>();
  const keyed = inTerm.flatMap((r) => {
    const key = subjectKey({
      legacyArea: r.legacy_area,
      name: r.subject_name,
      legacySubject: r.legacy_subject,
    });
    if (!key) return [];
    if (r.subject_name) {
      const spelling = r.subject_name.trim().replace(/\s+/g, " ");
      const bySpelling = spellings.get(key) ?? new Map<string, number>();
      bySpelling.set(spelling, (bySpelling.get(spelling) ?? 0) + Number(r.n));
      spellings.set(key, bySpelling);
    }
    return [{ ...r, key }];
  });
  const subjectLabels = new Map<string, string>();
  for (const r of keyed) {
    if (!subjectLabels.has(r.key)) {
      subjectLabels.set(r.key, subjectLabel(r.key, spellings.get(r.key) ?? new Map()));
    }
  }

  const scoreRows: FacetRow[] = keyed
    .filter((r) => r.kind === "score")
    .map((r) => ({
      schoolId: r.school_id!,
      gradeType: r.gt,
      field: "subject",
      bucket: r.key,
      count: Number(r.n80),
      base: Number(r.n),
      sum: Number(r.total),
    }));
  const scoreKeys = [...new Set(scoreRows.map((r) => r.bucket))].sort((a, b) =>
    subjectOrder(a, b, subjectLabels)
  );

  const sections: SummarySection[] = [
    buildSection({
      schools,
      level,
      id: "subjects",
      title: "Average and learners scoring 80 or above, per subject",
      kind: "average",
      byGrade: true,
      buckets: scoreKeys.map((k) => ({ id: k, label: subjectLabels.get(k) ?? k })),
      rows: scoreRows,
      baseLabel:
        "Count and % = learners scoring 80 or above, of learners with a grade in that subject; average = mean grade",
    }),
  ];

  const markRows = keyed.filter((r) => r.kind === "mark" && r.bucket);
  const markKeys = [...new Set(markRows.map((r) => r.key))].sort((a, b) =>
    subjectOrder(a, b, subjectLabels)
  );
  for (const key of markKeys) {
    sections.push(
      buildSection({
        schools,
        level,
        id: `grade1Marks:${key}`,
        title: `Grade 1 letter marks: ${subjectLabels.get(key) ?? key}`,
        kind: "single",
        byGrade: false,
        buckets: MARK_ORDER.map((m) => ({
          id: m,
          label: `${TERM_MARK_SHORT_LABELS[m]} - ${TERM_MARK_LABELS[m]}`,
        })),
        rows: markRows
          .filter((r) => r.key === key)
          .map((r) => ({
            schoolId: r.school_id!,
            gradeType: r.gt,
            field: "mark",
            bucket: r.bucket!,
            count: Number(r.n),
          })),
        baseLabel: "% of Grade 1 learners with a mark in the subject",
      })
    );
  }

  const termLabel = TERM_PERIOD_LABELS[term as keyof typeof TERM_PERIOD_LABELS] ?? term;
  return {
    facetId: "end-of-term",
    title: "End of term",
    subtitle: schoolYearLabel
      ? `${termLabel}, School Year ${schoolYearLabel}`
      : "No school year is active in these schools",
    level,
    params: { level, schoolYearLabel, term },
    schoolCount: schools.length,
    notes: [
      "Grades count toward the learner's current school; a learner who transferred mid-year brings earlier grades along.",
      "Subjects a school has removed are left out, as on the grade sheets.",
      "Kindergarten uses a competency checklist, not subject grades, so it is not included.",
    ],
    gaps: [
      "Grade 1 is graded with letter marks (A–E), so it has no average and no 80-or-above count; its marks are shown as a distribution instead.",
    ],
    sections,
    lists: [],
    options: { schoolYearLabels: labels },
    computedAt: args.computedAt,
  };
}
