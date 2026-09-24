import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  EDUCATIONAL_ATTAINMENT_LABELS,
  ENGLISH_TRAINING_LABELS,
  GRADE_LEVEL_LABELS,
  READING_TRAINING_LABELS,
  SCHOOL_HEAD_POSITION_LABELS,
  SPECIALIZATION_LABELS,
  SUBJECT_LABELS,
  TEACHER_POSITION_LABELS,
  TRAINING_LEVEL_LABELS,
} from "@/lib/constants/enum-labels";
import { inScopeSchools } from "@/lib/summary/queries/population";
import {
  DESIGNATION_BUCKETS,
  DESIGNATION_LABELS,
  YEARS_IN_SERVICE_BUCKETS,
  YEARS_IN_SERVICE_LABELS,
  bucketDesignation,
  bucketYearsInService,
} from "@/lib/summary/shape/profiling-buckets";
import {
  NOT_ANSWERED,
  NOT_APPLICABLE,
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
 * Facet `profiling` (spec 4.7): live, active, APPROVED teachers and live,
 * active School Heads, by their profiling answers. The base is completed
 * profiles; accounts with no profile are counted separately. Names, contact
 * numbers and emails are never read.
 */
export type RawProfilingRow = {
  school_id: string;
  who: "TEACHER" | "SCHOOL_HEAD";
  field: string;
  bucket: string | null;
  count: number;
};

export async function queryProfilingRows(schoolIds: readonly string[]): Promise<RawProfilingRow[]> {
  if (schoolIds.length === 0) return [];
  return prisma.$queryRaw<RawProfilingRow[]>(Prisma.sql`
    WITH acct AS (
      SELECT u."id", u."schoolId", u."role"::text AS who
      FROM "User" u
      WHERE ${inScopeSchools(Prisma.sql`u."schoolId"`, schoolIds)}
        AND u."deletedAt" IS NULL AND u."isActive" = true
        AND ((u."role" = 'TEACHER' AND u."approvalStatus" = 'APPROVED') OR u."role" = 'SCHOOL_HEAD')
    ),
    prof AS (
      SELECT a."schoolId", a.who, btrim(tp."designation") AS designation,
             tp."position"::text AS position, tp."educationalAttainment"::text AS attainment,
             tp."fieldOfSpecialization"::text AS specialization, tp."yearsInService" AS years,
             tp."currentGradeAssignment"::text AS grade, tp."mostSubjectHandled"::text AS subject,
             tp."hasReadingTraining" AS has_rt, tp."readingTrainings"::text[] AS rts,
             tp."hasEnglishTraining" AS has_et, tp."englishTrainings"::text[] AS ets,
             tp."highestTrainingLevel"::text AS training_level
      FROM acct a JOIN "TeacherProfile" tp ON tp."userId" = a."id"
      WHERE a.who = 'TEACHER'
      UNION ALL
      SELECT a."schoolId", a.who, btrim(sp."designation"),
             sp."position"::text, sp."educationalAttainment"::text,
             sp."fieldOfSpecialization"::text, sp."yearsInService",
             NULL::text, NULL::text,
             sp."hasReadingTraining", sp."readingTrainings"::text[],
             sp."hasEnglishTraining", sp."englishTrainings"::text[],
             sp."highestTrainingLevel"::text
      FROM acct a JOIN "SchoolHeadProfile" sp ON sp."userId" = a."id"
      WHERE a.who = 'SCHOOL_HEAD'
    )
    SELECT "schoolId" AS school_id, who, 'accounts'::text AS field, 'ALL'::text AS bucket, COUNT(*)::int AS count
      FROM acct GROUP BY 1, 2
    UNION ALL SELECT "schoolId", who, 'population', 'ALL', COUNT(*)::int FROM prof GROUP BY 1, 2
    UNION ALL SELECT "schoolId", who, 'designation', designation, COUNT(*)::int FROM prof GROUP BY 1, 2, 4
    UNION ALL SELECT "schoolId", who, 'position', position, COUNT(*)::int FROM prof GROUP BY 1, 2, 4
    UNION ALL SELECT "schoolId", who, 'attainment', attainment, COUNT(*)::int FROM prof GROUP BY 1, 2, 4
    UNION ALL SELECT "schoolId", who, 'specialization', specialization, COUNT(*)::int FROM prof GROUP BY 1, 2, 4
    UNION ALL SELECT "schoolId", who, 'years', years::text, COUNT(*)::int FROM prof GROUP BY 1, 2, 4
    UNION ALL SELECT "schoolId", who, 'grade', grade, COUNT(*)::int FROM prof WHERE who = 'TEACHER' GROUP BY 1, 2, 4
    UNION ALL SELECT "schoolId", who, 'subject', subject, COUNT(*)::int FROM prof WHERE who = 'TEACHER' GROUP BY 1, 2, 4
    UNION ALL SELECT "schoolId", who, 'hasReadingTraining', CASE WHEN has_rt THEN 'YES' ELSE 'NO' END, COUNT(*)::int
      FROM prof GROUP BY 1, 2, 4
    UNION ALL SELECT "schoolId", who, 'readingTrainings', t, COUNT(*)::int
      FROM prof CROSS JOIN LATERAL unnest(rts) AS t GROUP BY 1, 2, 4
    UNION ALL SELECT "schoolId", who, 'hasEnglishTraining', CASE WHEN has_et THEN 'YES' ELSE 'NO' END, COUNT(*)::int
      FROM prof GROUP BY 1, 2, 4
    UNION ALL SELECT "schoolId", who, 'englishTrainings', t, COUNT(*)::int
      FROM prof CROSS JOIN LATERAL unnest(ets) AS t GROUP BY 1, 2, 4
    UNION ALL SELECT "schoolId", who, 'trainingLevel', training_level, COUNT(*)::int FROM prof GROUP BY 1, 2, 4
  `);
}

/** SQL rows to facet rows, with free text and numbers bucketed. Field ids are `<who>.<field>`. */
export function profilingFacetRows(raw: readonly RawProfilingRow[]): FacetRow[] {
  const out: FacetRow[] = [];
  for (const r of raw) {
    let bucket: string;
    if (r.field === "designation") bucket = bucketDesignation(r.bucket);
    else if (r.field === "years") bucket = bucketYearsInService(r.bucket === null ? null : Number(r.bucket));
    else if (r.field === "position" && r.bucket === null) bucket = NOT_APPLICABLE;
    else bucket = r.bucket ?? NOT_ANSWERED;
    out.push({
      schoolId: r.school_id,
      gradeType: null,
      field: `${r.who}.${r.field}`,
      bucket,
      count: Number(r.count),
    });
  }
  // Accounts with no profile: accounts minus completed profiles, per school.
  const profiled = new Map<string, number>();
  for (const r of out) if (r.field.endsWith(".population")) profiled.set(`${r.schoolId}|${r.field}`, r.count);
  for (const r of out.filter((x) => x.field.endsWith(".accounts"))) {
    const who = r.field.split(".")[0];
    const done = profiled.get(`${r.schoolId}|${who}.population`) ?? 0;
    out.push({ schoolId: r.schoolId, gradeType: null, field: `${who}.profileStatus`, bucket: "PROFILED", count: done });
    if (r.count - done > 0) {
      out.push({
        schoolId: r.schoolId,
        gradeType: null,
        field: `${who}.profileStatus`,
        bucket: "NO_PROFILE",
        count: r.count - done,
      });
    }
  }
  return out;
}

const YES_NO = { YES: "Yes", NO: "No" };

function roleSections(
  who: "TEACHER" | "SCHOOL_HEAD",
  rows: readonly FacetRow[],
  schools: readonly ScopeSchool[],
  level: SummaryLevel
): SummarySection[] {
  const noun = who === "TEACHER" ? "teachers" : "School Heads";
  const title = who === "TEACHER" ? "Teachers" : "School Heads";
  const f = (field: string) => rowsOf(rows, `${who}.${field}`);
  const population = f("population");
  const common = { schools, level, byGrade: false };
  const single = `% of ${noun} with a completed profile`;
  const multi = `% of ${noun} with a completed profile (more than one may apply; does not add up to 100)`;
  const positionLabels = who === "TEACHER" ? TEACHER_POSITION_LABELS : SCHOOL_HEAD_POSITION_LABELS;

  const sections: SummarySection[] = [
    buildSection({
      ...common,
      id: `${who}.profileStatus`,
      title: `${title}: profiling completed`,
      kind: "single",
      buckets: bucketsFrom(["PROFILED", "NO_PROFILE"], { PROFILED: "Profile completed", NO_PROFILE: "No profile yet" }),
      rows: f("profileStatus"),
      baseLabel: `% of active ${noun}`,
    }),
    buildSection({
      ...common,
      id: `${who}.designation`,
      title: `${title}: designation`,
      kind: "single",
      buckets: bucketsFrom(DESIGNATION_BUCKETS, DESIGNATION_LABELS),
      rows: f("designation"),
      baseLabel: single,
      note: "Answers typed under \"Others\" are counted, not listed.",
    }),
    buildSection({
      ...common,
      id: `${who}.position`,
      title: `${title}: position`,
      kind: "single",
      buckets: bucketsFrom([...Object.keys(positionLabels), NOT_APPLICABLE], positionLabels),
      rows: f("position"),
      baseLabel: single,
    }),
    buildSection({
      ...common,
      id: `${who}.attainment`,
      title: `${title}: highest educational attainment`,
      kind: "single",
      buckets: bucketsFrom(Object.keys(EDUCATIONAL_ATTAINMENT_LABELS), EDUCATIONAL_ATTAINMENT_LABELS),
      rows: f("attainment"),
      baseLabel: single,
    }),
    buildSection({
      ...common,
      id: `${who}.specialization`,
      title: `${title}: field of specialization`,
      kind: "single",
      buckets: bucketsFrom(Object.keys(SPECIALIZATION_LABELS), SPECIALIZATION_LABELS),
      rows: f("specialization"),
      baseLabel: single,
      note: "The text typed for \"Others\" is not summarized.",
    }),
    buildSection({
      ...common,
      id: `${who}.years`,
      title: `${title}: years in service`,
      kind: "single",
      buckets: bucketsFrom(YEARS_IN_SERVICE_BUCKETS, YEARS_IN_SERVICE_LABELS),
      rows: f("years"),
      baseLabel: single,
    }),
  ];

  if (who === "TEACHER") {
    sections.push(
      buildSection({
        ...common,
        id: `${who}.grade`,
        title: `${title}: current grade level assignment`,
        kind: "single",
        buckets: bucketsFrom([...Object.keys(GRADE_LEVEL_LABELS), NOT_ANSWERED], GRADE_LEVEL_LABELS),
        rows: f("grade"),
        baseLabel: single,
        note: "The teacher's own profiling answer, not the section they are assigned to advise in the app.",
      }),
      buildSection({
        ...common,
        id: `${who}.subject`,
        title: `${title}: most subject handled`,
        kind: "single",
        buckets: bucketsFrom([...Object.keys(SUBJECT_LABELS), NOT_ANSWERED], SUBJECT_LABELS),
        rows: f("subject"),
        baseLabel: single,
        note: "No longer asked on the profiling form; only older profiles have an answer.",
      })
    );
  }

  sections.push(
    buildSection({
      ...common,
      id: `${who}.hasReadingTraining`,
      title: `${title}: attended literacy or reading training`,
      kind: "single",
      buckets: bucketsFrom(["YES", "NO"], YES_NO),
      rows: f("hasReadingTraining"),
      baseLabel: single,
    }),
    buildSection({
      ...common,
      id: `${who}.readingTrainings`,
      title: `${title}: literacy or reading trainings attended`,
      kind: "multi",
      buckets: bucketsFrom(Object.keys(READING_TRAINING_LABELS), READING_TRAINING_LABELS),
      rows: f("readingTrainings"),
      baseRows: population,
      baseLabel: multi,
    }),
    buildSection({
      ...common,
      id: `${who}.hasEnglishTraining`,
      title: `${title}: attended English curriculum training`,
      kind: "single",
      buckets: bucketsFrom(["YES", "NO"], YES_NO),
      rows: f("hasEnglishTraining"),
      baseLabel: single,
    }),
    buildSection({
      ...common,
      id: `${who}.englishTrainings`,
      title: `${title}: English curriculum trainings attended`,
      kind: "multi",
      buckets: bucketsFrom(Object.keys(ENGLISH_TRAINING_LABELS), ENGLISH_TRAINING_LABELS),
      rows: f("englishTrainings"),
      baseRows: population,
      baseLabel: multi,
    }),
    buildSection({
      ...common,
      id: `${who}.trainingLevel`,
      title: `${title}: highest level of training`,
      kind: "single",
      buckets: bucketsFrom(Object.keys(TRAINING_LEVEL_LABELS), TRAINING_LEVEL_LABELS),
      rows: f("trainingLevel"),
      baseLabel: single,
    })
  );
  return sections;
}

export function shapeProfiling(args: {
  raw: readonly RawProfilingRow[];
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  computedAt: string;
}): FacetResult {
  const { schools, level } = args;
  const rows = profilingFacetRows(args.raw);
  return {
    facetId: "profiling",
    title: "Teacher and School Head profiling",
    subtitle: "Active, approved teachers and active School Heads",
    level,
    params: { level },
    schoolCount: schools.length,
    notes: [
      "Percentages are of people who have completed their profiling; the first table of each group shows how many have not.",
      "Names, contact numbers and email addresses are not included.",
    ],
    gaps: [
      "\"Most subject handled\" was removed from the profiling form, so only older teacher profiles have an answer.",
      "School Heads are not asked their grade level assignment or most subject handled.",
    ],
    sections: [
      ...roleSections("TEACHER", rows, schools, level),
      ...roleSections("SCHOOL_HEAD", rows, schools, level),
    ],
    lists: [],
    computedAt: args.computedAt,
  };
}
