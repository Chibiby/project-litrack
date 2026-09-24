import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  READING_PROFILE_LABELS,
  readingProfileLabelsForGradeType,
} from "@/lib/constants/enum-labels";
import { EARLY_RUBRIC_VALUES, STANDARD_VALUES, languagesForGrade } from "@/lib/reading/policy";
import { populationCte } from "@/lib/summary/queries/population";
import {
  monthLabel,
  monthStartKey,
  monthsBetween,
  shiftMonth,
} from "@/lib/summary/shape/months";
import {
  READING_MOVEMENTS,
  READING_MOVEMENT_LABELS,
  classifyReadingMovement,
} from "@/lib/summary/shape/reading-movement";
import {
  NOT_ANSWERED,
  NOT_COLLECTED,
  NO_RECORD,
  buildSection,
  bucketsFrom,
} from "@/lib/summary/shape/section";
import type {
  FacetResult,
  FacetRow,
  ScopeSchool,
  SummaryLevel,
  SummarySection,
} from "@/lib/summary/types";

/**
 * Facet `reading-levels` (spec 4.5): ARAL learners' monthly English and
 * Filipino reading level per grade, and how many moved up, stayed, or moved
 * down since the month before.
 *
 * One record per learner per month (the latest `weekStart` in it). Movement is
 * decided per learner by the pure `classifyReadingMovement`; the SQL returns
 * (previous level, current level) transition counts so no learner-level rows
 * leave the database.
 */
export type RawReadingLevelRow = {
  kind: "population" | "dist" | "move";
  school_id: string;
  gt: string;
  month: string | null;
  lang: "ENGLISH" | "FILIPINO" | null;
  prev: string | null;
  val: string | null;
  n: number;
};

export async function queryReadingLevelRows(
  schoolIds: readonly string[],
  range: { from: string; to: string }
): Promise<RawReadingLevelRow[]> {
  if (schoolIds.length === 0) return [];
  // One month earlier than `from`, so the first month has something to move from.
  const scanStart = monthStartKey(shiftMonth(range.from, -1));
  const end = monthStartKey(shiftMonth(range.to, 1));
  return prisma.$queryRaw<RawReadingLevelRow[]>(Prisma.sql`
    WITH pop AS (${populationCte(schoolIds, { aral: true })}),
    m AS (
      SELECT DISTINCT ON (r."learnerId", to_char(r."weekStart", 'YYYY-MM'))
        r."learnerId",
        to_char(r."weekStart", 'YYYY-MM') AS month,
        r."englishProfile"::text AS en,
        r."filipinoProfile"::text AS fil
      FROM "ReadingLevelRecord" r
      JOIN pop p ON p."id" = r."learnerId"
      WHERE r."weekStart" >= ${scanStart}::date AND r."weekStart" < ${end}::date
      ORDER BY r."learnerId", to_char(r."weekStart", 'YYYY-MM'), r."weekStart" DESC
    ),
    v AS (
      SELECT m."learnerId", m.month, x.lang, x.val
      FROM m CROSS JOIN LATERAL (VALUES ('ENGLISH'::text, m.en), ('FILIPINO'::text, m.fil)) AS x(lang, val)
    )
    SELECT 'population'::text AS kind, p."schoolId" AS school_id, p.gt, NULL::text AS month,
           NULL::text AS lang, NULL::text AS prev, NULL::text AS val, COUNT(*)::int AS n
      FROM pop p GROUP BY 2, 3
    UNION ALL
    SELECT 'dist', p."schoolId", p.gt, v.month, v.lang, NULL, v.val, COUNT(*)::int
      FROM v JOIN pop p ON p."id" = v."learnerId"
      WHERE v.month >= ${range.from}
      GROUP BY 2, 3, 4, 5, 7
    UNION ALL
    SELECT 'move', p."schoolId", p.gt, cur.month, cur.lang, prev.val, cur.val, COUNT(*)::int
      FROM v cur
      JOIN v prev
        ON prev."learnerId" = cur."learnerId"
       AND prev.lang = cur.lang
       AND prev.month = to_char(to_date(cur.month, 'YYYY-MM') - interval '1 month', 'YYYY-MM')
      JOIN pop p ON p."id" = cur."learnerId"
      WHERE cur.month >= ${range.from} AND cur.val IS NOT NULL AND prev.val IS NOT NULL
      GROUP BY 2, 3, 4, 5, 6, 7
  `);
}

const PROFILE_BUCKETS = [
  ...STANDARD_VALUES,
  ...EARLY_RUBRIC_VALUES,
  NOT_ANSWERED,
  NO_RECORD,
  NOT_COLLECTED,
];

const LANGS = [
  { id: "ENGLISH", name: "English" },
  { id: "FILIPINO", name: "Filipino" },
] as const;

/**
 * The distribution rows for one month and language. Learners with no record
 * that month are "No record this month"; in a grade that does not record
 * English, every learner is "Not collected for this grade".
 */
export function readingLevelDistRows(
  raw: readonly RawReadingLevelRow[],
  month: string,
  lang: "ENGLISH" | "FILIPINO"
): FacetRow[] {
  const out: FacetRow[] = [];
  const recorded = new Map<string, number>();
  for (const r of raw) {
    if (r.kind !== "dist" || r.month !== month || r.lang !== lang) continue;
    if (lang === "ENGLISH" && !languagesForGrade(r.gt).includes("ENGLISH")) continue;
    out.push({
      schoolId: r.school_id,
      gradeType: r.gt,
      field: "level",
      bucket: r.val ?? NOT_ANSWERED,
      count: Number(r.n),
    });
    const k = `${r.school_id}|${r.gt}`;
    recorded.set(k, (recorded.get(k) ?? 0) + Number(r.n));
  }
  for (const r of raw) {
    if (r.kind !== "population") continue;
    const notCollected = lang === "ENGLISH" && !languagesForGrade(r.gt).includes("ENGLISH");
    const missing = notCollected
      ? Number(r.n)
      : Number(r.n) - (recorded.get(`${r.school_id}|${r.gt}`) ?? 0);
    if (missing > 0) {
      out.push({
        schoolId: r.school_id,
        gradeType: r.gt,
        field: "level",
        bucket: notCollected ? NOT_COLLECTED : NO_RECORD,
        count: missing,
      });
    }
  }
  return out;
}

export function readingMovementRows(
  raw: readonly RawReadingLevelRow[],
  month: string,
  lang: "ENGLISH" | "FILIPINO"
): FacetRow[] {
  return raw
    .filter((r) => r.kind === "move" && r.month === month && r.lang === lang && r.prev && r.val)
    .map((r) => ({
      schoolId: r.school_id,
      gradeType: r.gt,
      field: "movement",
      bucket: classifyReadingMovement(r.prev!, r.val!, r.gt),
      count: Number(r.n),
    }));
}

export function shapeReadingLevels(args: {
  raw: readonly RawReadingLevelRow[];
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  from: string;
  to: string;
  computedAt: string;
}): FacetResult {
  const { raw, schools, level, from, to } = args;
  const gradeLabels: Record<string, Record<string, string>> = {};
  for (const r of raw) {
    if (!gradeLabels[r.gt]) gradeLabels[r.gt] = readingProfileLabelsForGradeType(r.gt);
  }

  const sections: SummarySection[] = [];
  for (const month of monthsBetween(from, to)) {
    for (const lang of LANGS) {
      sections.push(
        buildSection({
          schools,
          level,
          id: `level:${lang.id}:${month}`,
          title: `${lang.name} reading level, ${monthLabel(month)}`,
          kind: "single",
          byGrade: true,
          buckets: bucketsFrom(PROFILE_BUCKETS, READING_PROFILE_LABELS),
          gradeBucketLabels: gradeLabels,
          rows: readingLevelDistRows(raw, month, lang.id),
          baseLabel: "% of ARAL learners in the grade",
        }),
        buildSection({
          schools,
          level,
          id: `movement:${lang.id}:${month}`,
          title: `${lang.name}: change from ${monthLabel(shiftMonth(month, -1))} to ${monthLabel(month)}`,
          kind: "single",
          byGrade: true,
          buckets: bucketsFrom(READING_MOVEMENTS, READING_MOVEMENT_LABELS),
          rows: readingMovementRows(raw, month, lang.id),
          baseLabel: "% of ARAL learners with a level recorded in both months",
        })
      );
    }
  }

  const period = from === to ? monthLabel(from) : `${monthLabel(from)} to ${monthLabel(to)}`;
  return {
    facetId: "reading-levels",
    title: "Monthly reading level",
    subtitle: `ARAL learners, ${period}`,
    level,
    params: { level, from, to },
    schoolCount: schools.length,
    notes: [
      "One record per learner for each month: the latest one saved in that month.",
      "Improved means a higher level than the month before in the same language; no improvement means the same level. A lower level is shown separately as declined.",
      "A level that is not on the grade's scale (for example a learner promoted from Kinder who still has a letter-rubric level) is not comparable.",
      "Grades 1 and 2 do not record English.",
    ],
    gaps: ["Monthly reading levels are recorded only for ARAL learners."],
    sections,
    lists: [],
    computedAt: args.computedAt,
  };
}
