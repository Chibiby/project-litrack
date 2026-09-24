import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { languagesForGrade } from "@/lib/reading/policy";
import { inScopeSchools, populationCte } from "@/lib/summary/queries/population";
import { lastFullWeek, monthKeyOf, monthStartKey, shiftMonth } from "@/lib/summary/shape/months";
import {
  COMPLIANCE_FLAGS,
  COMPLIANCE_FLAG_DEFINITIONS,
  COMPLIANCE_FLAG_LABELS,
  COMPLIANCE_REASON_FLAG,
  COMPLIANCE_REASON_LABELS,
  classifyCompliance,
  recentAttendanceFloorKey,
  type ComplianceFlags,
  type SchoolComplianceFacts,
} from "@/lib/summary/shape/compliance";
import { buildSection, bucketsFrom } from "@/lib/summary/shape/section";
import { NO_DISTRICT_LABEL } from "@/lib/summary/shape/rollup";
import type {
  FacetResult,
  FacetRow,
  ScopeSchool,
  SummaryLevel,
  SummaryList,
} from "@/lib/summary/types";

/**
 * Facet `compliance` (spec 4.6): which active schools are flagged, overall and
 * per district, listing the schools. One SQL round trip gathers every school's
 * facts; `classifyCompliance` decides the flags.
 */
export type RawComplianceRow = {
  school_id: string;
  live: number;
  non_archived: number;
  pending: number;
  grades_no_adviser: number;
  aral: number;
  incomplete: number;
  enrollments: number;
  drift: number;
  last_attendance: string | null;
  reading: number;
  last_week: number;
  has_admin: boolean;
};

/** Grade types that do not record English, from the reading policy — never hard-coded in SQL. */
function gradesWithoutEnglish(): string[] {
  return Object.keys(GRADE_LEVEL_LABELS).filter((t) => !languagesForGrade(t).includes("ENGLISH"));
}

export async function queryComplianceRows(
  schoolIds: readonly string[],
  todayKey: string
): Promise<RawComplianceRow[]> {
  if (schoolIds.length === 0) return [];
  const floor = recentAttendanceFloorKey(todayKey);
  const monthStart = monthStartKey(monthKeyOf(todayKey));
  const nextMonth = monthStartKey(shiftMonth(monthKeyOf(todayKey), 1));
  const week = lastFullWeek(todayKey);
  const noEnglish = gradesWithoutEnglish();
  return prisma.$queryRaw<RawComplianceRow[]>(Prisma.sql`
    WITH pop AS (${populationCte(schoolIds, {
      aral: false,
      columns: Prisma.sql`
        l."isAralLearner" AS aral,
        (l."nutritionalStatus" IS NULL) AS no_nutrition,
        (l."englishReadingProfile" IS NULL) AS no_english`,
    })}),
    aral_pop AS (SELECT "id", "schoolId" FROM pop WHERE aral),
    lrn AS (
      SELECT l."schoolId",
             COUNT(*)::int AS live,
             (COUNT(*) FILTER (WHERE l."archivedAt" IS NULL))::int AS non_archived
      FROM "Learner" l
      WHERE ${inScopeSchools(Prisma.sql`l."schoolId"`, schoolIds)} AND l."deletedAt" IS NULL
      GROUP BY 1
    ),
    popc AS (
      SELECT "schoolId",
             (COUNT(*) FILTER (WHERE aral))::int AS aral,
             (COUNT(*) FILTER (
               WHERE no_nutrition OR (no_english AND gt <> ALL(${noEnglish}::text[]))
             ))::int AS incomplete
      FROM pop GROUP BY 1
    ),
    pend AS (
      SELECT u."schoolId", COUNT(*)::int AS n
      FROM "User" u
      WHERE ${inScopeSchools(Prisma.sql`u."schoolId"`, schoolIds)}
        AND u."role" = 'TEACHER' AND u."approvalStatus" = 'PENDING' AND u."deletedAt" IS NULL
      GROUP BY 1
    ),
    gna AS (
      SELECT g."schoolId", COUNT(*)::int AS n
      FROM "GradeLevel" g
      WHERE ${inScopeSchools(Prisma.sql`g."schoolId"`, schoolIds)}
        AND g."deletedAt" IS NULL AND g."type" <> 'FLOATING'
        AND NOT EXISTS (
          SELECT 1 FROM "Section" sec
          JOIN "User" adv ON adv."id" = sec."adviserId"
          WHERE sec."gradeLevelId" = g."id" AND sec."deletedAt" IS NULL
            AND adv."isActive" = true AND adv."deletedAt" IS NULL
        )
      GROUP BY 1
    ),
    enr AS (
      SELECT e."schoolId", COUNT(*)::int AS n
      FROM "Enrollment" e
      JOIN "SchoolYear" sy ON sy."id" = e."schoolYearId"
      WHERE ${inScopeSchools(Prisma.sql`e."schoolId"`, schoolIds)}
        AND e."status" = 'ACTIVE' AND sy."isActive" = true
      GROUP BY 1
    ),
    drift AS (
      SELECT l."schoolId", COUNT(*)::int AS n
      FROM "Learner" l
      JOIN "Enrollment" e ON e."learnerId" = l."id" AND e."status" = 'ACTIVE'
      WHERE ${inScopeSchools(Prisma.sql`l."schoolId"`, schoolIds)}
        AND l."deletedAt" IS NULL AND e."gradeLevelId" <> l."gradeLevelId"
      GROUP BY 1
    ),
    att AS (
      SELECT a2."schoolId", to_char(MAX(a."date"), 'YYYY-MM-DD') AS last_key
      FROM "Attendance" a JOIN aral_pop a2 ON a2."id" = a."learnerId"
      WHERE a."date" >= ${floor}::date
      GROUP BY 1
    ),
    rd AS (
      SELECT a2."schoolId", COUNT(DISTINCT r."learnerId")::int AS n
      FROM "ReadingLevelRecord" r JOIN aral_pop a2 ON a2."id" = r."learnerId"
      WHERE r."weekStart" >= ${monthStart}::date AND r."weekStart" < ${nextMonth}::date
      GROUP BY 1
    ),
    wk AS (
      SELECT a2."schoolId", COUNT(DISTINCT a."learnerId")::int AS n
      FROM "Attendance" a JOIN aral_pop a2 ON a2."id" = a."learnerId"
      WHERE a."date" >= ${week.monday}::date AND a."date" <= ${week.friday}::date
      GROUP BY 1
    )
    SELECT s."id" AS school_id,
           COALESCE(lrn.live, 0) AS live,
           COALESCE(lrn.non_archived, 0) AS non_archived,
           COALESCE(pend.n, 0) AS pending,
           COALESCE(gna.n, 0) AS grades_no_adviser,
           COALESCE(popc.aral, 0) AS aral,
           COALESCE(popc.incomplete, 0) AS incomplete,
           COALESCE(enr.n, 0) AS enrollments,
           COALESCE(drift.n, 0) AS drift,
           att.last_key AS last_attendance,
           COALESCE(rd.n, 0) AS reading,
           COALESCE(wk.n, 0) AS last_week,
           EXISTS (
             SELECT 1 FROM "DistrictAdminAssignment" da
             JOIN "User" du ON du."id" = da."userId"
             WHERE da."district" = s."district"
               AND du."role" = 'DISTRICT_ADMIN' AND du."deletedAt" IS NULL AND du."isActive" = true
           ) AS has_admin
    FROM "School" s
    LEFT JOIN lrn ON lrn."schoolId" = s."id"
    LEFT JOIN pend ON pend."schoolId" = s."id"
    LEFT JOIN gna ON gna."schoolId" = s."id"
    LEFT JOIN popc ON popc."schoolId" = s."id"
    LEFT JOIN enr ON enr."schoolId" = s."id"
    LEFT JOIN drift ON drift."schoolId" = s."id"
    LEFT JOIN att ON att."schoolId" = s."id"
    LEFT JOIN rd ON rd."schoolId" = s."id"
    LEFT JOIN wk ON wk."schoolId" = s."id"
    WHERE ${inScopeSchools(Prisma.sql`s."id"`, schoolIds)}
  `);
}

export function complianceFacts(r: RawComplianceRow): SchoolComplianceFacts {
  return {
    liveLearners: Number(r.live),
    pendingTeachers: Number(r.pending),
    gradesWithoutAdviser: Number(r.grades_no_adviser),
    aralLearners: Number(r.aral),
    lastAttendanceKey: r.last_attendance,
    readingLearnersThisMonth: Number(r.reading),
    incompleteLearners: Number(r.incomplete),
    nonArchivedLearners: Number(r.non_archived),
    activeEnrollments: Number(r.enrollments),
    pointerDrift: Number(r.drift),
    lastWeekMarkedLearners: Number(r.last_week),
  };
}

const COMPLIANT = "COMPLIANT";

export function shapeCompliance(args: {
  raw: readonly RawComplianceRow[];
  /** Active schools in scope only. */
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  todayKey: string;
  computedAt: string;
}): FacetResult {
  const { schools, level, todayKey } = args;
  const bySchool = new Map(args.raw.map((r) => [r.school_id, r]));
  const classified = new Map<string, ComplianceFlags>();
  const rows: FacetRow[] = [];
  const baseRows: FacetRow[] = [];
  for (const s of schools) {
    const raw = bySchool.get(s.id);
    if (!raw) continue;
    const result = classifyCompliance(complianceFacts(raw), todayKey);
    classified.set(s.id, result);
    baseRows.push({ schoolId: s.id, gradeType: null, field: "schools", bucket: "ALL", count: 1 });
    const buckets = result.flags.length > 0 ? result.flags : [COMPLIANT];
    for (const flag of buckets) {
      rows.push({ schoolId: s.id, gradeType: null, field: "flag", bucket: flag, count: 1 });
    }
  }

  const columns = ["School", "School ID", "District", "Why"];
  const lists: SummaryList[] = COMPLIANCE_FLAGS.map((flag) => ({
    id: flag,
    title: COMPLIANCE_FLAG_LABELS[flag],
    note: COMPLIANCE_FLAG_DEFINITIONS[flag],
    columns,
    rows: schools
      .filter((s) => classified.get(s.id)?.flags.includes(flag))
      .sort((a, b) => (a.district ?? "").localeCompare(b.district ?? "") || a.name.localeCompare(b.name))
      .map((s) => [
        s.name,
        s.schoolIdCode,
        s.district ?? NO_DISTRICT_LABEL,
        classified
          .get(s.id)!
          .reasons.filter((reason) => COMPLIANCE_REASON_FLAG[reason] === flag)
          .map((reason) => COMPLIANCE_REASON_LABELS[reason])
          .join("; "),
      ]),
  }));
  const unsupervised = schools.filter((s) => bySchool.get(s.id) && !bySchool.get(s.id)!.has_admin);
  lists.push({
    id: "noDistrictAdmin",
    title: "Schools with no district admin",
    note: "No district admin is assigned to the school's district as it is spelled on the school record (spelling and capitals must match exactly), or the school has no district.",
    columns: ["School", "School ID", "District"],
    rows: unsupervised.map((s) => [s.name, s.schoolIdCode, s.district ?? NO_DISTRICT_LABEL]),
  });

  return {
    facetId: "compliance",
    title: "Non-compliance",
    subtitle: "Active schools",
    level,
    params: { level, today: todayKey },
    schoolCount: schools.length,
    notes: [
      ...COMPLIANCE_FLAGS.map((f) => `${COMPLIANCE_FLAG_LABELS[f]}: ${COMPLIANCE_FLAG_DEFINITIONS[f]}`),
      "A school can carry more than one flag, so the flags do not add up to 100%.",
      "Inactive schools are not included.",
    ],
    gaps: [],
    sections: [
      buildSection({
        schools,
        level,
        id: "flags",
        title: "Schools flagged",
        kind: "multi",
        byGrade: false,
        buckets: bucketsFrom([...COMPLIANCE_FLAGS, COMPLIANT], {
          ...COMPLIANCE_FLAG_LABELS,
          [COMPLIANT]: "No flags",
        }),
        rows,
        baseRows,
        baseLabel: "% of active schools (a school may have more than one flag; does not add up to 100)",
      }),
    ],
    lists,
    computedAt: args.computedAt,
  };
}
