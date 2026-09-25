import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  DISTANCE_LABELS,
  FRUSTRATION_SUBTYPE_LABELS,
  GENDER_LABELS,
  PARENT_EDUCATION_LABELS,
  READING_PROFILE_LABELS,
  TRANSFER_LABELS,
  TRANSPORTATION_LABELS,
  readingProfileLabelsForGradeType,
} from "@/lib/constants/enum-labels";
import { EARLY_RUBRIC_VALUES, STANDARD_VALUES, languagesForGrade } from "@/lib/reading/policy";
import { populationCte, type RawCountRow } from "@/lib/summary/queries/population";
import {
  NOT_ANSWERED,
  NOT_COLLECTED,
  buildSection,
  bucketsFrom,
  rowsOf,
} from "@/lib/summary/shape/section";
import type {
  FacetResult,
  FacetRow,
  ScopeSchool,
  SummaryLevel,
  SummarySection,
} from "@/lib/summary/types";

/**
 * Facet `learners` (spec 4.1): the active-enrolled population by age, gender,
 * reading profile (with frustration subtypes), 4Ps, parents' education,
 * transport, distance and previous transfers.
 *
 * One round trip. The nine single-valued fields (age, gender, both reading
 * profiles, 4Ps, parents' education, transport, distance, transfers) are
 * counted in a single pass: a `LATERAL VALUES` unpivot fans each `pop` row out
 * into nine (field, bucket) pairs, then one `GROUP BY` aggregates all of them
 * together. The two multi-valued frustration-subtype fields (a learner can
 * have more than one) still need their own `unnest` + filter each, and the
 * bare population count is cheapest kept separate — that leaves 4 scans of
 * `pop` instead of the 11 a UNION ALL of one GROUP BY per field costs. At
 * division scope (333 schools, ~33.6k learners after the join) that
 * consolidation roughly halves the repeated reads of the CTE's materialized
 * tuplestore. Measured on production (read-only, EXPLAIN ANALYZE): the old
 * per-field UNION ALL ran ~4.4s cold / ~0.6-1.0s warm with two 2s Learner and
 * Enrollment seq scans and the `pop` tuplestore spilling to a temp file
 * (~8.7MB, work_mem default 4MB); this form plus the `work_mem` bump below
 * eliminated the temp spill entirely and ran ~0.5-0.6s steady state, matching
 * the ~2s "well under" budget with real headroom.
 *
 * `SET LOCAL work_mem` is scoped to one transaction (PgBouncer transaction
 * pooling releases the backend at commit, so this never leaks to another
 * request) and only raises memory for this one aggregation-heavy query; every
 * other query on the connection keeps the server default.
 */
export async function queryLearnerRows(schoolIds: readonly string[]): Promise<RawCountRow[]> {
  if (schoolIds.length === 0) return [];
  const pop = populationCte(schoolIds, {
    aral: false,
    columns: Prisma.sql`
      l."age",
      l."gender"::text AS gender,
      l."englishReadingProfile"::text AS en,
      l."englishFrustrationSubtypes"::text[] AS en_sub,
      l."filipinoReadingProfile"::text AS fil,
      l."filipinoFrustrationSubtypes"::text[] AS fil_sub,
      ('FOUR_PS' = ANY(l."governmentBenefits"::text[])) AS four_ps,
      l."parentEducation"::text AS parent_ed,
      l."modeOfTransportation"::text AS transport,
      l."distanceHomeToSchool"::text AS distance,
      l."previousTransfers"::text AS transfers`,
  });
  const sql = Prisma.sql`
    WITH pop AS (${pop})
    SELECT "schoolId" AS school_id, gt, 'population' AS field, 'ALL' AS bucket, COUNT(*)::int AS count
      FROM pop GROUP BY 1, 2
    UNION ALL
    SELECT p."schoolId", p.gt, x.field, x.bucket, COUNT(*)::int AS count
      FROM pop p
      CROSS JOIN LATERAL (VALUES
        ('age', p."age"::text),
        ('gender', p.gender),
        ('englishProfile', p.en),
        ('filipinoProfile', p.fil),
        ('fourPs', CASE WHEN p.four_ps THEN 'YES' ELSE 'NO' END),
        ('parentEducation', p.parent_ed),
        ('transport', p.transport),
        ('distance', p.distance),
        ('transfers', p.transfers)
      ) AS x(field, bucket)
      GROUP BY 1, 2, 3, 4
    UNION ALL SELECT "schoolId", gt, 'englishSubtype', s, COUNT(*)::int
      FROM pop CROSS JOIN LATERAL unnest(en_sub) AS s
      WHERE en = 'FRUSTRATION_HIGH_EMERGENT' GROUP BY 1, 2, 4
    UNION ALL SELECT "schoolId", gt, 'filipinoSubtype', s, COUNT(*)::int
      FROM pop CROSS JOIN LATERAL unnest(fil_sub) AS s
      WHERE fil = 'FRUSTRATION_HIGH_EMERGENT' GROUP BY 1, 2, 4
  `;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL work_mem = '64MB'`;
    return tx.$queryRaw<RawCountRow[]>(sql);
  });
}

const FRUSTRATION = "FRUSTRATION_HIGH_EMERGENT";

/**
 * SQL rows to facet rows. A NULL English profile is "Not collected" in a grade
 * that does not record English (`languagesForGrade`) and "Not answered"
 * elsewhere; every other NULL is "Not answered".
 */
export function learnerFacetRows(raw: readonly RawCountRow[]): FacetRow[] {
  return raw.map((r) => {
    let bucket = r.bucket;
    if (bucket === null) {
      bucket =
        r.field === "englishProfile" && r.gt && !languagesForGrade(r.gt).includes("ENGLISH")
          ? NOT_COLLECTED
          : NOT_ANSWERED;
    }
    return { schoolId: r.school_id, gradeType: r.gt, field: r.field, bucket, count: Number(r.count) };
  });
}

const PROFILE_BUCKETS = [
  ...STANDARD_VALUES,
  ...EARLY_RUBRIC_VALUES,
  NOT_ANSWERED,
  NOT_COLLECTED,
];

function profileGradeLabels(rows: readonly FacetRow[]): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const r of rows) {
    if (r.gradeType && !out[r.gradeType]) out[r.gradeType] = readingProfileLabelsForGradeType(r.gradeType);
  }
  return out;
}

export function shapeLearners(args: {
  raw: readonly RawCountRow[];
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  computedAt: string;
}): FacetResult {
  const { schools, level } = args;
  const rows = learnerFacetRows(args.raw);
  const population = rowsOf(rows, "population");
  const common = { schools, level };

  const ages = [...new Set(rowsOf(rows, "age").map((r) => r.bucket))].sort(
    (a, b) => Number(a) - Number(b)
  );

  const sections: SummarySection[] = [
    buildSection({
      ...common,
      id: "age",
      title: "Age",
      kind: "single",
      byGrade: false,
      buckets: ages.map((a) => ({ id: a, label: a })),
      rows: rowsOf(rows, "age"),
      baseLabel: "% of learners",
      note: "The age entered when the learner was enrolled. There is no birthdate, so it is not recomputed.",
    }),
    buildSection({
      ...common,
      id: "gender",
      title: "Gender",
      kind: "single",
      byGrade: false,
      buckets: bucketsFrom(Object.keys(GENDER_LABELS), GENDER_LABELS),
      rows: rowsOf(rows, "gender"),
      baseLabel: "% of learners",
    }),
  ];

  for (const lang of ["english", "filipino"] as const) {
    const name = lang === "english" ? "English" : "Filipino";
    const profileRows = rowsOf(rows, `${lang}Profile`);
    sections.push(
      buildSection({
        ...common,
        id: `${lang}Profile`,
        title: `${name} reading profile`,
        kind: "single",
        byGrade: true,
        buckets: bucketsFrom(PROFILE_BUCKETS, READING_PROFILE_LABELS),
        gradeBucketLabels: profileGradeLabels(profileRows),
        rows: profileRows,
        baseLabel: "% of learners in the grade",
        note:
          lang === "english"
            ? "Grades 1 and 2 do not record an English reading profile. Kinder uses the letter and word rubric (Levels 0–3), shown in its own columns."
            : "Kinder uses the letter and word rubric (Levels 0–3), shown in its own columns.",
      }),
      buildSection({
        ...common,
        id: `${lang}Subtype`,
        title: `${name} frustration: what the difficulty is (% of all learners)`,
        kind: "multi",
        byGrade: true,
        buckets: bucketsFrom(Object.keys(FRUSTRATION_SUBTYPE_LABELS), FRUSTRATION_SUBTYPE_LABELS),
        rows: rowsOf(rows, `${lang}Subtype`),
        baseRows: population,
        baseLabel: "% of learners in the grade (a learner may have more than one; does not add up to 100)",
      }),
      buildSection({
        ...common,
        id: `${lang}SubtypeOfFrustration`,
        title: `${name} frustration: what the difficulty is (% of Frustration)`,
        kind: "multi",
        byGrade: true,
        buckets: bucketsFrom(Object.keys(FRUSTRATION_SUBTYPE_LABELS), FRUSTRATION_SUBTYPE_LABELS),
        rows: rowsOf(rows, `${lang}Subtype`),
        baseRows: profileRows.filter((r) => r.bucket === FRUSTRATION),
        baseLabel: "% of learners at Frustration (a learner may have more than one; does not add up to 100)",
      })
    );
  }

  sections.push(
    buildSection({
      ...common,
      id: "fourPs",
      title: "4Ps beneficiaries",
      kind: "single",
      byGrade: true,
      buckets: bucketsFrom(["YES", "NO"], { YES: "4Ps", NO: "Not 4Ps" }),
      rows: rowsOf(rows, "fourPs"),
      baseLabel: "% of learners in the grade",
    }),
    buildSection({
      ...common,
      id: "parentEducation",
      title: "Parents' educational background",
      kind: "single",
      byGrade: true,
      buckets: bucketsFrom(Object.keys(PARENT_EDUCATION_LABELS), PARENT_EDUCATION_LABELS),
      rows: rowsOf(rows, "parentEducation"),
      baseLabel: "% of learners in the grade",
      note: "One answer per learner; mother and father are not recorded separately.",
    }),
    buildSection({
      ...common,
      id: "transport",
      title: "Mode of transportation",
      kind: "single",
      byGrade: false,
      buckets: bucketsFrom([...Object.keys(TRANSPORTATION_LABELS), NOT_ANSWERED], TRANSPORTATION_LABELS),
      rows: rowsOf(rows, "transport"),
      baseLabel: "% of learners",
    }),
    buildSection({
      ...common,
      id: "distance",
      title: "Distance from home to school",
      kind: "single",
      byGrade: false,
      buckets: bucketsFrom([...Object.keys(DISTANCE_LABELS), NOT_ANSWERED], DISTANCE_LABELS),
      rows: rowsOf(rows, "distance"),
      baseLabel: "% of learners",
    }),
    buildSection({
      ...common,
      id: "transfers",
      title: "Previous school transfers",
      kind: "single",
      byGrade: false,
      buckets: bucketsFrom([...Object.keys(TRANSFER_LABELS), NOT_ANSWERED], TRANSFER_LABELS),
      rows: rowsOf(rows, "transfers"),
      baseLabel: "% of learners",
    })
  );

  return {
    facetId: "learners",
    title: "Learners",
    subtitle: "Learners enrolled in the active school year",
    level,
    params: { level },
    schoolCount: schools.length,
    notes: [
      "Counts learners with an active enrollment in their school's active school year, at their current grade.",
    ],
    gaps: [
      "The details typed under \"Specify\" for previous transfers are free text and are not summarized.",
    ],
    sections,
    lists: [],
    computedAt: args.computedAt,
  };
}
