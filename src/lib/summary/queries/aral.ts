import "server-only";
import { Prisma } from "@prisma/client";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { isAralVolunteerDesignation } from "@/lib/teachers/scope";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";
import { populationCte, runSummaryQuery } from "@/lib/summary/queries/population";
import type { ScopedRaw } from "@/lib/summary/scoped-raw";
import { NOT_ANSWERED, buildSection, bucketsFrom } from "@/lib/summary/shape/section";
import { pct } from "@/lib/summary/shape/pct";
import { NO_DISTRICT_LABEL } from "@/lib/summary/shape/rollup";
import type {
  FacetResult,
  FacetRow,
  ScopeSchool,
  SummaryBucket,
  SummaryLevel,
  SummaryList,
  SummarySection,
} from "@/lib/summary/types";

/**
 * Facets `aral` ("ARAL learners": learners per grade level) and `aral-teachers`
 * ("ARAL teachers": teachers currently designated as an ARAL teacher, DepEd /
 * Non-DepEd, overall and per grade level). Names, emails and contact numbers
 * are never read.
 *
 * `pop` is the ARAL population (`populationCte(..., { aral: true })`, same
 * population every other ARAL facet uses). The learner rows come straight from
 * it. The teacher rows walk DISTINCT `aralTeacherId`s through
 * `User`/`TeacherProfile` and group by the raw `employmentType`/`designation`
 * pair — the DepEd / Non-DepEd / Not answered decision itself is made in pure
 * TS (`classifyAralTeacher`), not in SQL, so it has its own unit test.
 */
export type RawAralRow = {
  school_id: string;
  /**
   * `grade`: ARAL learners per grade type. `teacher`: distinct ARAL teachers per school.
   * `teacherGrade`: distinct ARAL teachers per school and grade type, a teacher being
   * counted in every grade where they teach at least one ARAL learner.
   */
  field: "grade" | "teacher" | "teacherGrade";
  /** The grade type, for a `grade` or `teacherGrade` row; null for a `teacher` row. */
  bucket: string | null;
  /** `TeacherProfile.employmentType`, for a teacher row; null otherwise. */
  employment_type: string | null;
  /** `TeacherProfile.designation`, for a teacher row; null otherwise. */
  designation: string | null;
  count: number;
};

/** DepEd / Non-DepEd / not answered. */
export const ARAL_TEACHER_DEPED = "DEPED";
export const ARAL_TEACHER_NON_DEPED = "NON_DEPED";
/** Suffix of the per-grade teacher buckets: `<GRADE>|TOTAL`, `<GRADE>|DEPED`, `<GRADE>|NON_DEPED`. */
const GRADE_TOTAL = "TOTAL";

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
export function classifyAralTeacher(
  employmentType: string | null,
  designation: string | null
): typeof ARAL_TEACHER_DEPED | typeof ARAL_TEACHER_NON_DEPED | typeof NOT_ANSWERED {
  if (employmentType === "DEPED_PLANTILLA") return ARAL_TEACHER_DEPED;
  if (employmentType === "NON_DEPED") return ARAL_TEACHER_NON_DEPED;
  if (isAralVolunteerDesignation(designation)) return ARAL_TEACHER_NON_DEPED;
  if (designation != null && designation.trim() !== "") return ARAL_TEACHER_DEPED;
  return NOT_ANSWERED;
}

/**
 * Every school's learner rows (see `populationCte`): one per (school, grade).
 */
export async function queryAralLearnerRows(): Promise<RawAralRow[]> {
  const pop = populationCte({ aral: true });
  return runSummaryQuery<RawAralRow>(Prisma.sql`
    WITH pop AS (${pop})
    SELECT "schoolId" AS school_id, 'grade'::text AS field, gt AS bucket,
           NULL::text AS employment_type, NULL::text AS designation, COUNT(*)::int AS count
      FROM pop GROUP BY 1, 3
  `);
}

/**
 * Every school's ARAL teacher rows. Teachers are counted DISTINCT per school (and per
 * school and grade), so one school's rows never depend on another's and the
 * per-scope sums `rollUp` makes match a per-scope query.
 */
export async function queryAralTeacherRows(): Promise<RawAralRow[]> {
  const pop = populationCte({
    aral: true,
    columns: Prisma.sql`l."aralTeacherId" AS aral_teacher_id`,
  });
  return runSummaryQuery<RawAralRow>(Prisma.sql`
    WITH pop AS (${pop}),
    aral_teacher AS (
      SELECT DISTINCT pop."schoolId", pop.gt, u."id" AS teacher_id,
        tp."employmentType"::text AS employment_type, tp."designation" AS designation
      FROM pop
      JOIN "User" u ON u."id" = pop.aral_teacher_id
        AND u."role" = 'TEACHER' AND u."deletedAt" IS NULL AND u."isActive" = true
        AND u."approvalStatus" = 'APPROVED'
      LEFT JOIN "TeacherProfile" tp ON tp."userId" = u."id"
      WHERE pop.aral_teacher_id IS NOT NULL
    )
    SELECT "schoolId" AS school_id, 'teacher'::text AS field, NULL::text AS bucket,
           employment_type, designation, COUNT(DISTINCT teacher_id)::int AS count
      FROM aral_teacher GROUP BY 1, 4, 5
    UNION ALL
    SELECT "schoolId", 'teacherGrade'::text, gt, employment_type, designation,
           COUNT(DISTINCT teacher_id)::int
      FROM aral_teacher GROUP BY 1, 3, 4, 5
  `);
}

/**
 * SQL rows to facet rows. `gradeType` is unused here — the grade is the bucket,
 * not a split axis. Teacher rows are classified with `classifyAralTeacher` and
 * summed onto one row per (school, bucket), because more than one raw
 * `(employmentType, designation)` pair can land in the same bucket (e.g. two
 * different "Not answered" designations). A `teacherGrade` row becomes a
 * `<GRADE>|<class>` row plus a `<GRADE>|TOTAL` row.
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

  const sums = (field: "teacher" | "teacherGrade") => {
    const map = new Map<string, FacetRow>();
    const add = (schoolId: string, bucket: string, count: number) => {
      const key = `${schoolId}\u0000${bucket}`;
      const existing = map.get(key);
      if (existing) existing.count += count;
      else map.set(key, { schoolId, gradeType: null, field, bucket, count });
    };
    for (const r of raw) {
      if (r.field !== field) continue;
      const cls = classifyAralTeacher(r.employment_type, r.designation);
      const n = Number(r.count);
      if (field === "teacher") {
        add(r.school_id, cls, n);
      } else {
        const grade = r.bucket as string;
        add(r.school_id, `${grade}|${GRADE_TOTAL}`, n);
        if (cls !== NOT_ANSWERED) add(r.school_id, `${grade}|${cls}`, n);
      }
    }
    return [...map.values()];
  };

  return [...gradeRows, ...sums("teacher"), ...sums("teacherGrade")];
}

const GRADE_BUCKETS = Object.keys(GRADE_LEVEL_LABELS);

/** Grade buckets with at least one row of `rows` somewhere in the result, in enum order; the full list if none. */
function presentGradeBuckets(rows: readonly FacetRow[], gradeOf: (bucket: string) => string): string[] {
  const present = GRADE_BUCKETS.filter((g) => rows.some((r) => gradeOf(r.bucket) === g && r.count > 0));
  return present.length > 0 ? present : GRADE_BUCKETS;
}

const NAMES_NOTE = "Names, contact numbers and email addresses are not included.";

export function shapeAral(args: {
  raw: ScopedRaw<RawAralRow>;
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  computedAt: string;
}): FacetResult {
  const { schools, level } = args;
  const rows = aralFacetRows(args.raw);
  const gradeRows = rows.filter((r) => r.field === "grade");
  const learnersSection = buildSection({
    schools,
    level,
    byGrade: false,
    id: "learnersByGrade",
    title: "ARAL learners by grade level",
    kind: "single",
    buckets: bucketsFrom(
      presentGradeBuckets(gradeRows, (b) => b),
      GRADE_LEVEL_LABELS
    ),
    rows: gradeRows,
    baseLabel: "% of ARAL learners",
  });

  return {
    facetId: "aral",
    title: "ARAL learners",
    subtitle: "ARAL learners enrolled in the active school year",
    level,
    params: { level },
    schoolCount: schools.length,
    notes: [NAMES_NOTE],
    gaps: [],
    sections: [learnersSection],
    lists: [],
    exportList: aralLearnerExportList({ schools, level, learnersSection }),
    computedAt: args.computedAt,
  };
}

export function shapeAralTeachers(args: {
  raw: ScopedRaw<RawAralRow>;
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  computedAt: string;
}): FacetResult {
  const { schools, level } = args;
  const rows = aralFacetRows(args.raw);
  const common = { schools, level, byGrade: false };
  const teacherRows = rows.filter((r) => r.field === "teacher");
  const teacherGradeRows = rows.filter((r) => r.field === "teacherGrade");

  const teachersSection = buildSection({
    ...common,
    id: "teachers",
    title: "Teachers serving as ARAL teachers",
    kind: "single",
    buckets: bucketsFrom(
      [ARAL_TEACHER_DEPED, ARAL_TEACHER_NON_DEPED, NOT_ANSWERED],
      {
        [ARAL_TEACHER_DEPED]: "DepEd ARAL teachers",
        [ARAL_TEACHER_NON_DEPED]: "Non-DepEd ARAL teachers",
      }
    ),
    rows: teacherRows,
    baseLabel: "% of ARAL teachers",
  });

  const gradeIds = presentGradeBuckets(teacherGradeRows, (b) => b.split("|")[0] ?? b);
  const gradeBuckets: SummaryBucket[] = gradeIds.flatMap((g) => {
    const label = GRADE_LEVEL_LABELS[g] ?? g;
    return [
      { id: `${g}|${GRADE_TOTAL}`, label: `${label} total` },
      { id: `${g}|${ARAL_TEACHER_DEPED}`, label: `${label} DepEd` },
      { id: `${g}|${ARAL_TEACHER_NON_DEPED}`, label: `${label} Non-DepEd` },
    ];
  });
  const teachersByGradeSection = buildSection({
    ...common,
    id: "teachersByGrade",
    title: "ARAL teachers by grade level",
    kind: "multi",
    buckets: gradeBuckets,
    rows: teacherGradeRows,
    baseRows: teacherRows,
    baseLabel: "% of the row's ARAL teachers",
    note: "An ARAL teacher with ARAL learners in more than one grade is counted in each of those grades, so grade totals can add up to more than the row's ARAL teachers.",
  });

  return {
    facetId: "aral-teachers",
    title: "ARAL teachers",
    subtitle: "Teachers designated as ARAL teachers for ARAL learners in the active school year",
    level,
    params: { level },
    schoolCount: schools.length,
    notes: [
      "ARAL teacher figures reflect current ARAL teacher designations; there is no history of past designations.",
      NAMES_NOTE,
    ],
    gaps: [],
    sections: [teachersSection, teachersByGradeSection],
    lists: [],
    exportList: aralTeacherExportList({ schools, level, teachersSection, teachersByGradeSection }),
    computedAt: args.computedAt,
  };
}

/**
 * Facet `advisory`: teachers who advise a section, advisory (`DEFAULT`) vs
 * multi-advisory (`MULTI_GRADE`, never shown under that spelling), overall and
 * per grade level. `Section` carries no school year, so nothing here is scoped
 * to one (the adviser is whoever the live section names today). ARAL volunteers
 * and floating teachers are excluded; the teacher filters mirror
 * `queryAralTeacherRows`. Names and contacts are never read.
 */
export type RawAdvisoryRow = {
  school_id: string;
  /** `adviser`: distinct advisers per school and mode. `adviserGrade`: per school and grade type. */
  field: "adviser" | "adviserGrade";
  /** `TeacherProfile.advisoryMode` for an `adviser` row; the grade type for an `adviserGrade` row. */
  bucket: string;
  count: number;
};

const ADVISORY_DEFAULT = "DEFAULT";
const ADVISORY_MULTI = "MULTI_GRADE";

export async function queryAdvisoryRows(): Promise<RawAdvisoryRow[]> {
  return runSummaryQuery<RawAdvisoryRow>(Prisma.sql`
    WITH adv AS (
      SELECT DISTINCT s."schoolId", g."type"::text AS gt, u."id" AS teacher_id,
        COALESCE(tp."advisoryMode"::text, 'DEFAULT') AS mode
      FROM "Section" s
      JOIN "GradeLevel" g ON g."id" = s."gradeLevelId"
      JOIN "User" u ON u."id" = s."adviserId" AND u."schoolId" = s."schoolId"
        AND u."role" = 'TEACHER' AND u."deletedAt" IS NULL AND u."isActive" = true
        AND u."approvalStatus" = 'APPROVED'
      LEFT JOIN "TeacherProfile" tp ON tp."userId" = u."id"
      WHERE s."deletedAt" IS NULL
        AND COALESCE(tp."advisoryMode"::text, 'DEFAULT') <> 'FLOATING'
        AND tp."designation" IS DISTINCT FROM ${ARAL_VOLUNTEER_DESIGNATION}
    )
    SELECT "schoolId" AS school_id, 'adviser'::text AS field, mode AS bucket,
           COUNT(DISTINCT teacher_id)::int AS count
      FROM adv GROUP BY 1, 3
    UNION ALL
    SELECT "schoolId", 'adviserGrade'::text, gt, COUNT(DISTINCT teacher_id)::int
      FROM adv GROUP BY 1, 3
  `);
}

export function shapeAdvisory(args: {
  raw: ScopedRaw<RawAdvisoryRow>;
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  computedAt: string;
}): FacetResult {
  const { schools, level } = args;
  const rows: FacetRow[] = args.raw.map((r) => ({
    schoolId: r.school_id,
    gradeType: null,
    field: r.field,
    bucket: r.bucket,
    count: Number(r.count),
  }));
  const adviserRows = rows.filter((r) => r.field === "adviser");
  const gradeRows = rows.filter((r) => r.field === "adviserGrade");
  const common = { schools, level, byGrade: false };

  const advisersSection = buildSection({
    ...common,
    id: "advisers",
    title: "Teachers who advise a section",
    kind: "single",
    buckets: bucketsFrom([ADVISORY_DEFAULT, ADVISORY_MULTI], {
      [ADVISORY_DEFAULT]: "Advisory",
      [ADVISORY_MULTI]: "Multi-advisory",
    }),
    rows: adviserRows,
    baseLabel: "% of the row's advisers",
  });
  const advisersByGradeSection = buildSection({
    ...common,
    id: "advisersByGrade",
    title: "Advisers by grade level",
    kind: "multi",
    buckets: bucketsFrom(presentGradeBuckets(gradeRows, (b) => b), GRADE_LEVEL_LABELS),
    rows: gradeRows,
    baseRows: adviserRows,
    baseLabel: "% of the row's advisers",
    note: "A multi-advisory teacher with sections in more than one grade is counted in each of those grades, so grade counts can add up to more than the row's advisers.",
  });

  return {
    facetId: "advisory",
    title: "Advisory",
    subtitle: "Teachers who advise a section, advisory and multi-advisory, per grade level",
    level,
    params: { level },
    schoolCount: schools.length,
    notes: [NAMES_NOTE],
    gaps: [],
    sections: [advisersSection, advisersByGradeSection],
    lists: [],
    exportList: advisoryExportList({ schools, level, advisersSection, advisersByGradeSection }),
    computedAt: args.computedAt,
  };
}

const EXPORT_LEVEL_COLUMN: Record<SummaryLevel, string> = {
  overall: "Scope",
  district: "District",
  school: "School",
};

type Cell = string | number | null;

/**
 * Shared export skeleton: one row per group built by `figures`, lead columns
 * (School / School ID / District at school level, District at district level,
 * Scope overall), and at school and district level a Total row closing the
 * list when there is more than one row. `figures(totals)` is called with the
 * summed raw numbers for the Total row so percentages are recomputed.
 */
function buildExportRows(args: {
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  groups: readonly { key: string; label: string; schoolId?: string }[];
  rowNumbers: (key: string) => number[];
  figures: (n: number[]) => Cell[];
}): Cell[][] {
  const { schools, level, groups } = args;
  const byId = new Map(schools.map((s) => [s.id, s]));
  const lead = (label: string, schoolId?: string): Cell[] => {
    if (level !== "school") return [label];
    const s = schoolId ? byId.get(schoolId) : undefined;
    return [label, s?.schoolIdCode ?? "", s?.district ?? NO_DISTRICT_LABEL];
  };
  let totals: number[] | null = null;
  const rows = groups.map((g) => {
    const n = args.rowNumbers(g.key);
    totals = totals ? totals.map((t, i) => t + (n[i] ?? 0)) : [...n];
    return [...lead(g.label, g.schoolId), ...args.figures(n)];
  });
  if (level !== "overall" && rows.length > 1 && totals) {
    const blanks = level === "school" ? ["", ""] : [];
    rows.push(["Total", ...blanks, ...args.figures(totals)]);
  }
  return rows;
}

function leadColumns(level: SummaryLevel): string[] {
  return [EXPORT_LEVEL_COLUMN[level], ...(level === "school" ? ["School ID", "District"] : [])];
}

/** Advisory export: advisory and multi-advisory counts, the total, then advisers per present grade. */
function advisoryExportList(args: {
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  advisersSection: SummarySection;
  advisersByGradeSection: SummarySection;
}): SummaryList {
  const { schools, level, advisersSection, advisersByGradeSection } = args;
  const advisersByKey = new Map(advisersSection.table.groups.map((g) => [g.key, g]));
  const gradesByKey = new Map(advisersByGradeSection.table.groups.map((g) => [g.key, g]));
  const gradeBuckets = advisersByGradeSection.buckets;

  return {
    id: "advisory-per-school",
    title: "Advisory",
    note: "A multi-advisory teacher with sections in more than one grade is counted in each of those grades, so grade columns can add up to more than Total advisers.",
    columns: [
      ...leadColumns(level),
      "Advisory",
      "Multi-advisory",
      "Total advisers",
      ...gradeBuckets.map((b) => `${b.label} advisers`),
    ],
    rows: buildExportRows({
      schools,
      level,
      groups: advisersSection.table.groups,
      // [advisory, multi-advisory, ...per-grade counts]
      rowNumbers: (key) => {
        const a = advisersByKey.get(key);
        const g = gradesByKey.get(key);
        return [
          a?.cells[ADVISORY_DEFAULT]?.count ?? 0,
          a?.cells[ADVISORY_MULTI]?.count ?? 0,
          ...gradeBuckets.map((b) => g?.cells[b.id]?.count ?? 0),
        ];
      },
      figures: (n) => {
        const [advisory = 0, multi = 0] = n;
        return [advisory, multi, advisory + multi, ...n.slice(2)];
      },
    }),
  };
}

/**
 * Learners export: one row per school (district, scope) with the ARAL learner
 * count first, then per grade a count and its % of the row's ARAL learners.
 */
function aralLearnerExportList(args: {
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  learnersSection: SummarySection;
}): SummaryList {
  const { schools, level, learnersSection } = args;
  const byKey = new Map(learnersSection.table.groups.map((g) => [g.key, g]));
  const gradeBuckets = learnersSection.buckets;

  return {
    id: "aral-learners-per-school",
    title: "ARAL learners",
    note: "<Grade> % is of the row's ARAL learners; a blank % means the row has no ARAL learners.",
    columns: [
      ...leadColumns(level),
      "ARAL learners",
      ...gradeBuckets.flatMap((b) => [b.label, `${b.label} %`]),
    ],
    rows: buildExportRows({
      schools,
      level,
      groups: learnersSection.table.groups,
      // [total learners, ...per-grade counts]
      rowNumbers: (key) => {
        const g = byKey.get(key);
        return [g?.base ?? 0, ...gradeBuckets.map((b) => g?.cells[b.id]?.count ?? 0)];
      },
      figures: (n) => {
        const total = n[0] ?? 0;
        return [total, ...gradeBuckets.flatMap((_, i) => [n[i + 1] ?? 0, pct(n[i + 1] ?? 0, total)])];
      },
    }),
  };
}

/**
 * ARAL teachers export: one row per school (district, scope) with the ARAL
 * teacher counts first (DepEd, Non-DepEd, optionally not answered, total), then
 * the percentages, then per grade the total, DepEd and Non-DepEd counts. A
 * "Not answered" column appears only when some ARAL teacher has no
 * designation.
 */
function aralTeacherExportList(args: {
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  teachersSection: SummarySection;
  teachersByGradeSection: SummarySection;
}): SummaryList {
  const { schools, level, teachersSection, teachersByGradeSection } = args;
  const teachersByKey = new Map(teachersSection.table.groups.map((g) => [g.key, g]));
  const gradesByKey = new Map(teachersByGradeSection.table.groups.map((g) => [g.key, g]));
  const gradeBuckets = teachersByGradeSection.buckets;
  const showNotAnswered = teachersSection.table.groups.some((g) => (g.cells[NOT_ANSWERED]?.count ?? 0) > 0);
  const presentGrades = gradeBuckets.filter((b) => b.id.endsWith(`|${GRADE_TOTAL}`));

  return {
    id: "aral-teachers-per-school",
    title: "ARAL teachers",
    note: "% DepEd and % Non-DepEd are of the row's ARAL teachers; a blank % means the row has no ARAL teachers. An ARAL teacher with ARAL learners in more than one grade is counted in each of those grades, so grade columns can add up to more than Total ARAL teachers.",
    columns: [
      ...leadColumns(level),
      "DepEd ARAL teachers",
      "Non-DepEd ARAL teachers",
      ...(showNotAnswered ? ["Not answered"] : []),
      "Total ARAL teachers",
      "% DepEd",
      "% Non-DepEd",
      ...presentGrades.flatMap((b) => {
        const label = b.label.replace(/ total$/, "");
        return [`${label} ARAL teachers`, `${label} DepEd`, `${label} Non-DepEd`];
      }),
    ],
    rows: buildExportRows({
      schools,
      level,
      groups: teachersSection.table.groups,
      // [deped, nonDeped, notAnswered, ...per-grade-bucket counts]
      rowNumbers: (key) => {
        const t = teachersByKey.get(key);
        const g = gradesByKey.get(key);
        return [
          t?.cells[ARAL_TEACHER_DEPED]?.count ?? 0,
          t?.cells[ARAL_TEACHER_NON_DEPED]?.count ?? 0,
          t?.cells[NOT_ANSWERED]?.count ?? 0,
          ...gradeBuckets.map((b) => g?.cells[b.id]?.count ?? 0),
        ];
      },
      figures: (n) => {
        const [deped = 0, nonDeped = 0, notAnswered = 0] = n;
        const teachers = deped + nonDeped + notAnswered;
        return [
          deped,
          nonDeped,
          ...(showNotAnswered ? [notAnswered] : []),
          teachers,
          pct(deped, teachers),
          pct(nonDeped, teachers),
          ...n.slice(3),
        ];
      },
    }),
  };
}
