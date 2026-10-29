import "server-only";
import { Prisma } from "@prisma/client";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { isAralVolunteerDesignation } from "@/lib/teachers/scope";
import { populationCte, runSummaryQuery } from "@/lib/summary/queries/population";
import type { ScopedRaw } from "@/lib/summary/scoped-raw";
import { NOT_ANSWERED, buildSection, bucketsFrom } from "@/lib/summary/shape/section";
import { pct } from "@/lib/summary/shape/pct";
import { NO_DISTRICT_LABEL } from "@/lib/summary/shape/rollup";
import type {
  FacetResult,
  FacetRow,
  ScopeSchool,
  SummaryLevel,
  SummaryList,
  SummarySection,
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
 * outright (even over a volunteer-looking designation). No form writes
 * `employmentType`, so it is null for almost everyone and the designation
 * decides, the same way the rest of the app tells a volunteer from a DepEd
 * teacher: the volunteer designation reads as Non-DepEd, any other designation
 * as DepEd. Only a blank designation, including no profile at all, is Not
 * answered.
 */
export function classifyAralTutor(
  employmentType: string | null,
  designation: string | null
): typeof ARAL_TUTOR_DEPED | typeof ARAL_TUTOR_NON_DEPED | typeof NOT_ANSWERED {
  if (employmentType === "DEPED_PLANTILLA") return ARAL_TUTOR_DEPED;
  if (employmentType === "NON_DEPED") return ARAL_TUTOR_NON_DEPED;
  if (isAralVolunteerDesignation(designation)) return ARAL_TUTOR_NON_DEPED;
  if (designation != null && designation.trim() !== "") return ARAL_TUTOR_DEPED;
  return NOT_ANSWERED;
}

/**
 * Every school's rows (see `populationCte`). Tutors are counted DISTINCT per
 * school, so one school's rows never depend on another's and the per-scope
 * sums `rollUp` makes match the old per-scope query.
 */
export async function queryAralRows(): Promise<RawAralRow[]> {
  const pop = populationCte({
    aral: true,
    columns: Prisma.sql`l."aralTeacherId" AS aral_teacher_id`,
  });
  return runSummaryQuery<RawAralRow>(Prisma.sql`
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
  raw: ScopedRaw<RawAralRow>;
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  computedAt: string;
}): FacetResult {
  const { schools, level } = args;
  const rows = aralFacetRows(args.raw);
  const common = { schools, level, byGrade: false };
  const gradeRows = rows.filter((r) => r.field === "grade");
  const gradeBuckets = presentGradeBuckets(gradeRows);
  const learnersSection = buildSection({
    ...common,
    id: "learnersByGrade",
    title: "ARAL learners by grade level",
    kind: "single",
    buckets: bucketsFrom(gradeBuckets, GRADE_LEVEL_LABELS),
    rows: gradeRows,
    baseLabel: "% of ARAL learners",
  });
  const tutorsSection = buildSection({
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
  });

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
    sections: [learnersSection, tutorsSection],
    lists: [],
    exportList: aralExportList({ schools, level, learnersSection, tutorsSection }),
    computedAt: args.computedAt,
  };
}

const EXPORT_LEVEL_COLUMN: Record<SummaryLevel, string> = {
  overall: "Scope",
  district: "District",
  school: "School",
};

/**
 * Export only: one row per school (or district, or the whole scope) with the
 * counts first — ARAL learners, DepEd tutors, Non-DepEd tutors, all tutors —
 * then the tutor percentages, then the learner count per grade. A "Tutor type
 * not answered" column appears only when some tutor has no designation. At
 * school and district level, a Total row closes the list.
 */
function aralExportList(args: {
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  learnersSection: SummarySection;
  tutorsSection: SummarySection;
}): SummaryList {
  const { schools, level, learnersSection, tutorsSection } = args;
  const byId = new Map(schools.map((s) => [s.id, s]));
  const tutorsByKey = new Map(tutorsSection.table.groups.map((g) => [g.key, g]));
  const gradeBuckets = learnersSection.buckets;
  const tutorCount = (key: string, bucket: string) => tutorsByKey.get(key)?.cells[bucket]?.count ?? 0;
  const showNotAnswered = tutorsSection.table.groups.some((g) => (g.cells[NOT_ANSWERED]?.count ?? 0) > 0);

  const lead = (label: string, schoolId?: string): (string | number | null)[] => {
    if (level !== "school") return [label];
    const s = schoolId ? byId.get(schoolId) : undefined;
    return [label, s?.schoolIdCode ?? "", s?.district ?? NO_DISTRICT_LABEL];
  };
  const figures = (learners: number, deped: number, nonDeped: number, notAnswered: number, grades: number[]) => {
    const tutors = deped + nonDeped + notAnswered;
    return [
      learners,
      deped,
      nonDeped,
      ...(showNotAnswered ? [notAnswered] : []),
      tutors,
      pct(deped, tutors),
      pct(nonDeped, tutors),
      ...grades,
    ];
  };

  const totals = { learners: 0, deped: 0, nonDeped: 0, notAnswered: 0, grades: gradeBuckets.map(() => 0) };
  const rows = learnersSection.table.groups.map((g) => {
    const deped = tutorCount(g.key, ARAL_TUTOR_DEPED);
    const nonDeped = tutorCount(g.key, ARAL_TUTOR_NON_DEPED);
    const notAnswered = tutorCount(g.key, NOT_ANSWERED);
    const grades = gradeBuckets.map((b) => g.cells[b.id]?.count ?? 0);
    totals.learners += g.base;
    totals.deped += deped;
    totals.nonDeped += nonDeped;
    totals.notAnswered += notAnswered;
    grades.forEach((n, i) => (totals.grades[i] += n));
    return [...lead(g.label, g.schoolId), ...figures(g.base, deped, nonDeped, notAnswered, grades)];
  });
  if (level !== "overall" && rows.length > 1) {
    const blanks = level === "school" ? ["", ""] : [];
    rows.push([
      "Total",
      ...blanks,
      ...figures(totals.learners, totals.deped, totals.nonDeped, totals.notAnswered, totals.grades),
    ]);
  }

  return {
    id: "aral-per-school",
    title: "ARAL learners and tutors",
    note: "% DepEd and % Non-DepEd are of the row's ARAL tutors; a blank % means the row has no tutors. Grade columns count ARAL learners.",
    columns: [
      EXPORT_LEVEL_COLUMN[level],
      ...(level === "school" ? ["School ID", "District"] : []),
      "ARAL learners",
      "DepEd tutors",
      "Non-DepEd tutors",
      ...(showNotAnswered ? ["Tutor type not answered"] : []),
      "Total tutors",
      "% DepEd",
      "% Non-DepEd",
      ...gradeBuckets.map((b) => b.label),
    ],
    rows,
  };
}
