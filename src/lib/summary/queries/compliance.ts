import "server-only";
import { Prisma } from "@prisma/client";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { languagesForGrade } from "@/lib/reading/policy";
import { resolveMosyWindow } from "@/lib/reports/mosy-window";
import { populationCte, runSummaryQuery } from "@/lib/summary/queries/population";
import type { ScopedRaw } from "@/lib/summary/scoped-raw";
import { lastFullWeek, monthKeyOf, monthStartKey, shiftMonth } from "@/lib/summary/shape/months";
import {
  COMPLIANCE_FLAGS,
  COMPLIANCE_FLAG_DEFINITIONS,
  COMPLIANCE_FLAG_LABELS,
  COMPLIANCE_REASON_FLAG,
  classifyCompliance,
  describeComplianceReason,
  recentAttendanceFloorKey,
  type ComplianceFlag,
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
  mosy_not_updated: number;
  mosy_for_decision: number;
  /** Active school year's `startDate` as an ISO instant, or null for no active year. */
  sy_start: string | null;
  /** The School Head's Second Term (MOSY) override for that year, or nulls. */
  mosy_override_start: string | null;
  mosy_override_end: string | null;
  mosy_override_deadline: string | null;
};

/** Grade types that do not record English, from the reading policy — never hard-coded in SQL. */
function gradesWithoutEnglish(): string[] {
  return Object.keys(GRADE_LEVEL_LABELS).filter((t) => !languagesForGrade(t).includes("ENGLISH"));
}

/**
 * One row per live school, every school (see `populationCte`); `scopeRaw`
 * keeps the caller's active ones.
 */
export async function queryComplianceRows(todayKey: string): Promise<RawComplianceRow[]> {
  const floor = recentAttendanceFloorKey(todayKey);
  const monthStart = monthStartKey(monthKeyOf(todayKey));
  const nextMonth = monthStartKey(shiftMonth(monthKeyOf(todayKey), 1));
  const week = lastFullWeek(todayKey);
  const noEnglish = gradesWithoutEnglish();
  const sql = Prisma.sql`
    WITH pop AS (${populationCte({
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
      WHERE l."deletedAt" IS NULL
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
      WHERE u."schoolId" IS NOT NULL
        AND u."role" = 'TEACHER' AND u."approvalStatus" = 'PENDING' AND u."deletedAt" IS NULL
      GROUP BY 1
    ),
    gna AS (
      SELECT g."schoolId", COUNT(*)::int AS n
      FROM "GradeLevel" g
      WHERE g."deletedAt" IS NULL AND g."type" <> 'FLOATING'
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
      WHERE e."status" = 'ACTIVE' AND sy."isActive" = true
      GROUP BY 1
    ),
    drift AS (
      SELECT l."schoolId", COUNT(*)::int AS n
      FROM "Learner" l
      JOIN "Enrollment" e ON e."learnerId" = l."id" AND e."status" = 'ACTIVE'
      WHERE l."deletedAt" IS NULL AND e."gradeLevelId" <> l."gradeLevelId"
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
    ),
    -- The MOSY page's roster (live, non-archived, ARAL-tagged) against the
    -- active year's decisions. A MOVE_OUT on a still-tagged learner reads
    -- "for decision", as mosyRowStatus does.
    mosy AS (
      SELECT l."schoolId",
             (COUNT(*) FILTER (WHERE d."id" IS NULL))::int AS not_updated,
             (COUNT(*) FILTER (
               WHERE d."id" IS NOT NULL AND (d."decision" IS NULL OR d."decision" = 'MOVE_OUT')
             ))::int AS for_decision
      FROM "Learner" l
      JOIN "SchoolYear" sy ON sy."schoolId" = l."schoolId" AND sy."isActive" = true
      LEFT JOIN "AralMosyDecision" d ON d."learnerId" = l."id" AND d."schoolYearId" = sy."id"
      WHERE l."deletedAt" IS NULL AND l."archivedAt" IS NULL AND l."isAralLearner" = true
      GROUP BY 1
    ),
    sy AS (
      SELECT y."schoolId",
             to_char(y."startDate", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS start_iso,
             o."startKey" AS o_start, o."endKey" AS o_end, o."deadlineKey" AS o_deadline
      FROM "SchoolYear" y
      LEFT JOIN "TermWindowOverride" o ON o."schoolYearId" = y."id" AND o."term" = 'SECOND'
      WHERE y."isActive" = true
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
           COALESCE(mosy.not_updated, 0) AS mosy_not_updated,
           COALESCE(mosy.for_decision, 0) AS mosy_for_decision,
           sy.start_iso AS sy_start,
           sy.o_start AS mosy_override_start,
           sy.o_end AS mosy_override_end,
           sy.o_deadline AS mosy_override_deadline,
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
    LEFT JOIN mosy ON mosy."schoolId" = s."id"
    LEFT JOIN sy ON sy."schoolId" = s."id"
    WHERE s."deletedAt" IS NULL
  `;
  return runSummaryQuery<RawComplianceRow>(sql);
}

/**
 * Whether MOSY counts against the school on `todayKey`: its active year's MOSY
 * (Second Term) window has started, honouring the School Head's override.
 */
export function isMosyDue(r: RawComplianceRow, todayKey: string): boolean {
  if (!r.sy_start) return false;
  const override =
    r.mosy_override_start && r.mosy_override_end && r.mosy_override_deadline
      ? [
          {
            term: "SECOND" as const,
            startKey: r.mosy_override_start,
            endKey: r.mosy_override_end,
            deadlineKey: r.mosy_override_deadline,
          },
        ]
      : [];
  return todayKey >= resolveMosyWindow(new Date(r.sy_start), override).startKey;
}

export function complianceFacts(r: RawComplianceRow, todayKey: string): SchoolComplianceFacts {
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
    mosy: isMosyDue(r, todayKey)
      ? { notUpdated: Number(r.mosy_not_updated), forDecision: Number(r.mosy_for_decision) }
      : null,
  };
}

const COMPLIANT = "COMPLIANT";

export function shapeCompliance(args: {
  raw: ScopedRaw<RawComplianceRow>;
  /** Active schools in scope only. */
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  todayKey: string;
  computedAt: string;
}): FacetResult {
  const { schools, level, todayKey } = args;
  const bySchool = new Map(args.raw.map((r) => [r.school_id, r]));
  const classified = new Map<string, ComplianceFlags>();
  const factsBySchool = new Map<string, SchoolComplianceFacts>();
  const whyOf = (schoolId: string, flag: ComplianceFlag): string[] => {
    const facts = factsBySchool.get(schoolId)!;
    return classified
      .get(schoolId)!
      .reasons.filter((reason) => COMPLIANCE_REASON_FLAG[reason] === flag)
      .map((reason) => describeComplianceReason(reason, facts));
  };
  const rows: FacetRow[] = [];
  const baseRows: FacetRow[] = [];
  for (const s of schools) {
    const raw = bySchool.get(s.id);
    if (!raw) continue;
    const facts = complianceFacts(raw, todayKey);
    const result = classifyCompliance(facts, todayKey);
    classified.set(s.id, result);
    factsBySchool.set(s.id, facts);
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
        whyOf(s.id, flag).join("; "),
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

  const flagsSection = buildSection({
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
  });
  // One row per school: print why each flag fired under its count.
  if (level === "school") {
    const cellNotes: Record<string, Record<string, string[]>> = {};
    for (const [schoolId, result] of classified) {
      if (result.flags.length === 0) continue;
      cellNotes[`school:${schoolId}`] = Object.fromEntries(
        result.flags.map((flag) => [flag, whyOf(schoolId, flag)])
      );
    }
    flagsSection.cellNotes = cellNotes;
  }

  // Export only, school level: each flagged school once, with what it misses.
  let exportList: SummaryList | undefined;
  if (level === "school") {
    const flagged = schools
      .filter((s) => (classified.get(s.id)?.flags.length ?? 0) > 0)
      .sort((a, b) => (a.district ?? "").localeCompare(b.district ?? "") || a.name.localeCompare(b.name));
    const unflagged = schools.filter((s) => classified.has(s.id)).length - flagged.length;
    exportList = {
      id: "flagged-schools",
      title: "Schools flagged",
      note: `${unflagged} ${unflagged === 1 ? "school has" : "schools have"} no flags.`,
      columns: ["School", "School ID", "District", "Non-compliance", "Remarks"],
      rows: flagged.map((s) => {
        const flags = classified.get(s.id)!.flags;
        return [
          s.name,
          s.schoolIdCode,
          s.district ?? NO_DISTRICT_LABEL,
          flags.map((f) => COMPLIANCE_FLAG_LABELS[f]).join(", "),
          flags.map((f) => `${COMPLIANCE_FLAG_LABELS[f]}: ${whyOf(s.id, f).join("; ")}`).join("\n"),
        ];
      }),
    };
  }

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
    sections: [flagsSection],
    lists,
    ...(exportList ? { exportList } : {}),
    computedAt: args.computedAt,
  };
}
