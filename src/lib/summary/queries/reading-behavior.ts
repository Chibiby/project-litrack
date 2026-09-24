import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  WEEKLY_READING_COMPREHENSION_LEVEL_LABELS,
  WEEKLY_WORD_RECOGNITION_LEVEL_LABELS,
} from "@/lib/constants/enum-labels";
import { populationCte, type RawCountRow } from "@/lib/summary/queries/population";
import { monthLabel, monthStartKey, shiftMonth } from "@/lib/summary/shape/months";
import {
  NOT_ANSWERED,
  NO_RECORD,
  buildSection,
  bucketsFrom,
  rowsOf,
} from "@/lib/summary/shape/section";
import type { FacetResult, FacetRow, ScopeSchool, SummaryLevel } from "@/lib/summary/types";

/**
 * Facet `reading-behavior` (spec 4.2): ARAL learners' word recognition and
 * reading comprehension level in one month (default July of the school year).
 *
 * One record per learner per month: the latest `weekStart` in the month
 * (`DISTINCT ON`), because legacy weekly rows can share a month.
 */
export async function queryReadingBehaviorRows(
  schoolIds: readonly string[],
  month: string
): Promise<RawCountRow[]> {
  if (schoolIds.length === 0) return [];
  const start = monthStartKey(month);
  const end = monthStartKey(shiftMonth(month, 1));
  return prisma.$queryRaw<RawCountRow[]>(Prisma.sql`
    WITH pop AS (${populationCte(schoolIds, { aral: true })}),
    rec AS (
      SELECT DISTINCT ON (r."learnerId")
        r."learnerId",
        r."wordRecognitionLevel"::text AS word,
        r."readingComprehensionLevel"::text AS comp
      FROM "ReadingLevelRecord" r
      JOIN pop p ON p."id" = r."learnerId"
      WHERE r."weekStart" >= ${start}::date AND r."weekStart" < ${end}::date
      ORDER BY r."learnerId", r."weekStart" DESC
    )
    SELECT p."schoolId" AS school_id, p.gt, 'population' AS field, 'ALL' AS bucket, COUNT(*)::int AS count
      FROM pop p GROUP BY 1, 2
    UNION ALL
    SELECT p."schoolId", p.gt, 'wordRecognition',
           CASE WHEN rec."learnerId" IS NULL THEN ${NO_RECORD}::text ELSE rec.word END, COUNT(*)::int
      FROM pop p LEFT JOIN rec ON rec."learnerId" = p."id" GROUP BY 1, 2, 4
    UNION ALL
    SELECT p."schoolId", p.gt, 'comprehension',
           CASE WHEN rec."learnerId" IS NULL THEN ${NO_RECORD}::text ELSE rec.comp END, COUNT(*)::int
      FROM pop p LEFT JOIN rec ON rec."learnerId" = p."id" GROUP BY 1, 2, 4
  `);
}

/**
 * The DOCX numbers comprehension 6–8 where the app says Level 1–3 (Q6
 * default): the app label is kept, prefixed with the DOCX number, in the
 * summary only.
 */
export const COMPREHENSION_SUMMARY_LABELS: Record<string, string> = {
  LEVEL_1: `Level 6: ${WEEKLY_READING_COMPREHENSION_LEVEL_LABELS.LEVEL_1.replace(/^Level 1:\s*/, "")}`,
  LEVEL_2: `Level 7: ${WEEKLY_READING_COMPREHENSION_LEVEL_LABELS.LEVEL_2.replace(/^Level 2:\s*/, "")}`,
  LEVEL_3: `Level 8: ${WEEKLY_READING_COMPREHENSION_LEVEL_LABELS.LEVEL_3.replace(/^Level 3:\s*/, "")}`,
  LEVEL_0: WEEKLY_READING_COMPREHENSION_LEVEL_LABELS.LEVEL_0,
  NA: WEEKLY_READING_COMPREHENSION_LEVEL_LABELS.NA,
};

const WORD_ORDER = ["LEVEL_0", "LEVEL_1", "LEVEL_2", "LEVEL_3", "LEVEL_4", "LEVEL_5", "NA"];
const COMP_ORDER = ["LEVEL_0", "LEVEL_1", "LEVEL_2", "LEVEL_3", "NA"];

function toRows(raw: readonly RawCountRow[]): FacetRow[] {
  return raw.map((r) => ({
    schoolId: r.school_id,
    gradeType: r.gt,
    field: r.field,
    bucket: r.bucket ?? NOT_ANSWERED,
    count: Number(r.count),
  }));
}

export function shapeReadingBehavior(args: {
  raw: readonly RawCountRow[];
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  month: string;
  computedAt: string;
}): FacetResult {
  const { schools, level, month } = args;
  const rows = toRows(args.raw);
  const common = { schools, level };
  return {
    facetId: "reading-behavior",
    title: "Reading behaviour",
    subtitle: `ARAL learners, as of ${monthLabel(month)}`,
    level,
    params: { level, month },
    schoolCount: schools.length,
    notes: [
      "One record per learner for the month: the latest one saved in that month.",
      "Reading comprehension Levels 6, 7 and 8 are the app's Levels 1, 2 and 3 (literal, inferential, critical).",
    ],
    gaps: [
      "Word recognition and reading comprehension are recorded only for ARAL learners, so learners outside ARAL have no figures here.",
    ],
    sections: [
      buildSection({
        ...common,
        id: "wordRecognition",
        title: "Word recognition level",
        kind: "single",
        byGrade: true,
        buckets: bucketsFrom([...WORD_ORDER, NOT_ANSWERED, NO_RECORD], WEEKLY_WORD_RECOGNITION_LEVEL_LABELS),
        rows: rowsOf(rows, "wordRecognition"),
        baseLabel: "% of ARAL learners in the grade",
      }),
      buildSection({
        ...common,
        id: "comprehension",
        title: "Reading comprehension level",
        kind: "single",
        byGrade: true,
        buckets: bucketsFrom([...COMP_ORDER, NOT_ANSWERED, NO_RECORD], COMPREHENSION_SUMMARY_LABELS),
        rows: rowsOf(rows, "comprehension"),
        baseLabel: "% of ARAL learners in the grade",
      }),
    ],
    lists: [],
    computedAt: args.computedAt,
  };
}
