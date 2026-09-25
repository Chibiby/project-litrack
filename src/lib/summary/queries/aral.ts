import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { isAralVolunteerDesignation } from "@/lib/teachers/scope";
import { populationCte } from "@/lib/summary/queries/population";
import { NOT_ANSWERED, buildSection, bucketsFrom } from "@/lib/summary/shape/section";
import type {
  FacetResult,
  FacetRow,
  ScopeSchool,
  SummaryLevel,
} from "@/lib/summary/types";

/**
 * Facet `aral` ("ARAL learners and tutors"): how many ARAL learners there are
 * per grade level, and how many teachers are currently designated as an ARAL
 * tutor, split DepEd / Non-DepEd. Names, emails and contact numbers are never
 * read.
 *
 * One round trip. `pop` is the ARAL population (`populationCte(..., { aral:
 * true })`, same population every other ARAL facet uses); the grade rows come
 * straight from it. The tutor rows walk DISTINCT `aralTeacherId`s through
 * `User`/`TeacherProfile` and group by the raw `employmentType`/`designation`
 * pair — the DepEd / Non-DepEd / Not answered decision itself is made in pure
 * TS (`classifyAralTutor`), not in SQL, so it has its own unit test.
 */
export type RawAralRow = {
  school_id: string;
  field: "grade" | "tutor";
  /** The grade type, for a `grade` row; null for a `tutor` row. */
  bucket: string | null;
  /** `TeacherProfile.employmentType`, for a `tutor` row; null otherwise. */
  employment_type: string | null;
  /** `TeacherProfile.designation`, for a `tutor` row; null otherwise. */
  designation: string | null;
  count: number;
};

/** DepEd / Non-DepEd / not answered. */
export const ARAL_TUTOR_DEPED = "DEPED";
export const ARAL_TUTOR_NON_DEPED = "NON_DEPED";

/**
 * The DepEd / Non-DepEd / Not answered rule, built on `isAralVolunteerDesignation`
 * so it can never drift from the one place that decides what a volunteer
 * designation is: `employmentType` set to `DEPED_PLANTILLA` or `NON_DEPED` wins
 * outright (even over a volunteer-looking designation); otherwise a volunteer
 * designation with no `employmentType` reads as Non-DepEd; everything else,
 * including no profile at all, is Not answered.
 */
export function classifyAralTutor(
  employmentType: string | null,
  designation: string | null
): typeof ARAL_TUTOR_DEPED | typeof ARAL_TUTOR_NON_DEPED | typeof NOT_ANSWERED {
  if (employmentType === "DEPED_PLANTILLA") return ARAL_TUTOR_DEPED;
  if (employmentType === "NON_DEPED") return ARAL_TUTOR_NON_DEPED;
  if (employmentType === null && isAralVolunteerDesignation(designation)) return ARAL_TUTOR_NON_DEPED;
  return NOT_ANSWERED;
}

export async function queryAralRows(schoolIds: readonly string[]): Promise<RawAralRow[]> {
  if (schoolIds.length === 0) return [];
  const pop = populationCte(schoolIds, {
    aral: true,
    columns: Prisma.sql`l."aralTeacherId" AS aral_teacher_id`,
  });
  return prisma.$queryRaw<RawAralRow[]>(Prisma.sql`
    WITH pop AS (${pop}),
    tutor AS (
      SELECT DISTINCT pop."schoolId", u."id" AS teacher_id,
        tp."employmentType"::text AS employment_type, tp."designation" AS designation
      FROM pop
      JOIN "User" u ON u."id" = pop.aral_teacher_id
        AND u."role" = 'TEACHER' AND u."deletedAt" IS NULL AND u."isActive" = true
        AND u."approvalStatus" = 'APPROVED'
      LEFT JOIN "TeacherProfile" tp ON tp."userId" = u."id"
      WHERE pop.aral_teacher_id IS NOT NULL
    )
    SELECT "schoolId" AS school_id, 'grade'::text AS field, gt AS bucket,
           NULL::text AS employment_type, NULL::text AS designation, COUNT(*)::int AS count
      FROM pop GROUP BY 1, 3
    UNION ALL
    SELECT "schoolId", 'tutor'::text, NULL::text, employment_type, designation,
           COUNT(DISTINCT teacher_id)::int
      FROM tutor GROUP BY 1, 4, 5
  `);
}

/**
 * SQL rows to facet rows. `gradeType` is unused here — the grade is the bucket,
 * not a split axis. Tutor rows are classified with `classifyAralTutor` and
 * summed onto one row per (school, bucket), because more than one raw
 * `(employmentType, designation)` pair can land in the same bucket (e.g. two
 * different "Not answered" designations).
 */
export function aralFacetRows(raw: readonly RawAralRow[]): FacetRow[] {
  const gradeRows: FacetRow[] = raw
    .filter((r) => r.field === "grade")
    .map((r) => ({
      schoolId: r.school_id,
      gradeType: null,
      field: "grade",
      bucket: r.bucket as string,
      count: Number(r.count),
    }));

  const tutorSums = new Map<string, { schoolId: string; bucket: string; count: number }>();
  for (const r of raw) {
    if (r.field !== "tutor") continue;
    const bucket = classifyAralTutor(r.employment_type, r.designation);
    const key = `${r.school_id}|${bucket}`;
    const existing = tutorSums.get(key);
    if (existing) existing.count += Number(r.count);
    else tutorSums.set(key, { schoolId: r.school_id, bucket, count: Number(r.count) });
  }
  const tutorRows: FacetRow[] = [...tutorSums.values()].map((t) => ({
    schoolId: t.schoolId,
    gradeType: null,
    field: "tutor",
    bucket: t.bucket,
    count: t.count,
  }));

  return [...gradeRows, ...tutorRows];
}

const GRADE_BUCKETS = Object.keys(GRADE_LEVEL_LABELS);

/** Grade buckets with at least one ARAL learner somewhere in the result, in enum order; the full list if none. */
function presentGradeBuckets(gradeRows: readonly FacetRow[]): string[] {
  const present = GRADE_BUCKETS.filter((g) => gradeRows.some((r) => r.bucket === g && r.count > 0));
  return present.length > 0 ? present : GRADE_BUCKETS;
}

export function shapeAral(args: {
  raw: readonly RawAralRow[];
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  computedAt: string;
}): FacetResult {
  const { schools, level } = args;
  const rows = aralFacetRows(args.raw);
  const common = { schools, level, byGrade: false };
  const gradeRows = rows.filter((r) => r.field === "grade");
  const gradeBuckets = presentGradeBuckets(gradeRows);

  return {
    facetId: "aral",
    title: "ARAL learners and tutors",
    subtitle: "ARAL learners enrolled in the active school year, and their designated ARAL tutors",
    level,
    params: { level },
    schoolCount: schools.length,
    notes: [
      "Tutor figures reflect current ARAL tutor designations; there is no history of past designations.",
      "Names, contact numbers and email addresses are not included.",
    ],
    gaps: [],
    sections: [
      buildSection({
        ...common,
        id: "learnersByGrade",
        title: "ARAL learners by grade level",
        kind: "single",
        buckets: bucketsFrom(gradeBuckets, GRADE_LEVEL_LABELS),
        rows: gradeRows,
        baseLabel: "% of ARAL learners",
      }),
      buildSection({
        ...common,
        id: "tutors",
        title: "Teachers serving as ARAL tutors",
        kind: "single",
        buckets: bucketsFrom(
          [ARAL_TUTOR_DEPED, ARAL_TUTOR_NON_DEPED, NOT_ANSWERED],
          { [ARAL_TUTOR_DEPED]: "DepEd teacher", [ARAL_TUTOR_NON_DEPED]: "Non-DepEd" }
        ),
        rows: rows.filter((r) => r.field === "tutor"),
        baseLabel: "% of ARAL tutors",
      }),
    ],
    lists: [],
    computedAt: args.computedAt,
  };
}
