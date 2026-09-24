import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { attendancePossibleMarks } from "@/lib/attendance/week-stats";
import { populationCte } from "@/lib/summary/queries/population";
import {
  monthKeyOf,
  monthLabel,
  monthStartKey,
  monthsBetween,
  mondaysInMonths,
  shiftMonth,
} from "@/lib/summary/shape/months";
import { buildSection } from "@/lib/summary/shape/section";
import { NO_DISTRICT_LABEL } from "@/lib/summary/shape/rollup";
import type {
  FacetResult,
  FacetRow,
  ScopeSchool,
  SummaryLevel,
  SummaryList,
} from "@/lib/summary/types";

/**
 * Facet `attendance` (spec 4.4): the weekly and monthly attendance rate of ARAL
 * learners, and the schools with nothing recorded or nobody present.
 *
 * The rate is the app's existing definition (`attendanceRatePct` /
 * `attendancePossibleMarks` in `src/lib/attendance/week-stats.ts`): PRESENT
 * marks on school days over (current ARAL learners in the grade × school days),
 * where school days are Monday to Friday minus that grade's holidays. LATE is
 * not present (Q5). The summary shows it to one decimal, like every summary
 * percentage.
 */
export type RawAttendanceRow = {
  kind: "roster" | "present" | "holiday" | "marks";
  school_id: string | null;
  grade_level_id: string | null;
  gt: string | null;
  week: string | null;
  n: number;
};

export async function queryAttendanceRows(
  schoolIds: readonly string[],
  range: { from: string; to: string; todayKey: string }
): Promise<RawAttendanceRow[]> {
  if (schoolIds.length === 0) return [];
  const start = monthStartKey(range.from);
  const end = monthStartKey(shiftMonth(range.to, 1));
  return prisma.$queryRaw<RawAttendanceRow[]>(Prisma.sql`
    WITH pop AS (${populationCte(schoolIds, { aral: true })}),
    att AS (
      SELECT p."schoolId", p."gradeLevelId", a."date", a."weekStart", a."status"::text AS status
      FROM "Attendance" a
      JOIN pop p ON p."id" = a."learnerId"
      WHERE a."weekStart" >= ${start}::date AND a."weekStart" < ${end}::date
        AND a."weekStart" <= ${range.todayKey}::date
    )
    SELECT 'roster'::text AS kind, "schoolId" AS school_id, "gradeLevelId" AS grade_level_id, gt,
           NULL::text AS week, COUNT(*)::int AS n
      FROM pop GROUP BY 2, 3, 4
    UNION ALL
    SELECT 'present', att."schoolId", att."gradeLevelId", NULL, to_char(att."weekStart", 'YYYY-MM-DD'),
           COUNT(*)::int
      FROM att
      WHERE att.status = 'PRESENT'
        AND EXTRACT(ISODOW FROM att."date") <= 5
        AND NOT EXISTS (
          SELECT 1 FROM "AttendanceDayMeta" m
          WHERE m."gradeLevelId" = att."gradeLevelId" AND m."date" = att."date" AND m."isHoliday" = true
        )
      GROUP BY 2, 3, 5
    UNION ALL
    SELECT 'holiday', NULL, m."gradeLevelId", NULL,
           to_char(m."date" - (EXTRACT(ISODOW FROM m."date")::int - 1), 'YYYY-MM-DD'), COUNT(*)::int
      FROM "AttendanceDayMeta" m
      WHERE m."isHoliday" = true
        AND EXTRACT(ISODOW FROM m."date") <= 5
        AND m."date" >= ${start}::date AND m."date" < (${end}::date + 7)
        AND m."gradeLevelId" IN (SELECT DISTINCT "gradeLevelId" FROM pop)
      GROUP BY 3, 5
    UNION ALL
    SELECT 'marks', att."schoolId", NULL, NULL, NULL, COUNT(*)::int FROM att GROUP BY 2
  `);
}

/** "Week of September 14, 2026". */
function weekLabel(mondayKey: string): string {
  const [month, year] = monthLabel(monthKeyOf(mondayKey)).split(" ");
  return `Week of ${month} ${Number(mondayKey.slice(8, 10))}, ${year}`;
}

/**
 * Per (school, grade, week): PRESENT marks over possible marks. Weeks come from
 * the calendar (every Monday in range, up to today), so a week nobody recorded
 * still counts against the rate, as it does on the School Head's cards.
 */
export function attendanceFacetRows(
  raw: readonly RawAttendanceRow[],
  weeks: readonly string[]
): { weekly: FacetRow[]; monthly: FacetRow[] } {
  const holidays = new Map<string, number>();
  const present = new Map<string, number>();
  for (const r of raw) {
    if (r.kind === "holiday" && r.grade_level_id && r.week) {
      holidays.set(`${r.grade_level_id}|${r.week}`, Number(r.n));
    } else if (r.kind === "present" && r.grade_level_id && r.week) {
      present.set(`${r.grade_level_id}|${r.week}`, Number(r.n));
    }
  }
  const weekly: FacetRow[] = [];
  const monthly: FacetRow[] = [];
  for (const r of raw) {
    if (r.kind !== "roster" || !r.school_id || !r.grade_level_id) continue;
    for (const week of weeks) {
      const key = `${r.grade_level_id}|${week}`;
      const schoolDays = Math.max(0, 5 - (holidays.get(key) ?? 0));
      const possible = attendancePossibleMarks({ learnerCount: Number(r.n), schoolDays });
      const presentMarks = present.get(key) ?? 0;
      const row = { schoolId: r.school_id, gradeType: r.gt, count: presentMarks, base: possible };
      weekly.push({ ...row, field: "week", bucket: week });
      monthly.push({ ...row, field: "month", bucket: monthKeyOf(week) });
    }
  }
  return { weekly, monthly };
}

function schoolListRow(s: ScopeSchool): (string | number | null)[] {
  return [s.name, s.schoolIdCode, s.district ?? NO_DISTRICT_LABEL];
}

export function shapeAttendance(args: {
  raw: readonly RawAttendanceRow[];
  schools: readonly ScopeSchool[];
  level: SummaryLevel;
  from: string;
  to: string;
  todayKey: string;
  computedAt: string;
}): FacetResult {
  const { raw, schools, level, from, to } = args;
  const weeks = mondaysInMonths(from, to, args.todayKey);
  const months = monthsBetween(from, to);
  const { weekly, monthly } = attendanceFacetRows(raw, weeks);

  const rosterBySchool = new Map<string, number>();
  const marksBySchool = new Map<string, number>();
  for (const r of raw) {
    if (!r.school_id) continue;
    if (r.kind === "roster") rosterBySchool.set(r.school_id, (rosterBySchool.get(r.school_id) ?? 0) + Number(r.n));
    if (r.kind === "marks") marksBySchool.set(r.school_id, Number(r.n));
  }
  const presentBySchool = new Map<string, number>();
  for (const r of weekly) presentBySchool.set(r.schoolId, (presentBySchool.get(r.schoolId) ?? 0) + r.count);

  const noAral = schools.filter((s) => !rosterBySchool.get(s.id));
  const noRecords = schools.filter((s) => rosterBySchool.get(s.id) && !marksBySchool.get(s.id));
  const zeroPresent = schools.filter(
    (s) => rosterBySchool.get(s.id) && marksBySchool.get(s.id) && !presentBySchool.get(s.id)
  );
  const columns = ["School", "School ID", "District"];
  const lists: SummaryList[] = [
    {
      id: "noAttendanceRecorded",
      title: "No attendance recorded",
      note: "Schools with ARAL learners and no attendance marks in the period.",
      columns,
      rows: noRecords.map(schoolListRow),
    },
    {
      id: "zeroPresent",
      title: "Recorded, 0% present",
      note: "Schools that recorded attendance in the period but marked nobody present.",
      columns,
      rows: zeroPresent.map(schoolListRow),
    },
    {
      id: "noAralLearners",
      title: "No ARAL learners",
      note: "These schools have no ARAL learners, so no attendance is expected. They are not counted as 0%.",
      columns,
      rows: noAral.map(schoolListRow),
    },
  ];

  const common = { schools, level };
  const period = from === to ? monthLabel(from) : `${monthLabel(from)} to ${monthLabel(to)}`;
  return {
    facetId: "attendance",
    title: "Weekly attendance",
    subtitle: `ARAL learners, ${period}`,
    level,
    params: { level, from, to },
    schoolCount: schools.length,
    notes: [
      "Attendance rate = days marked Present ÷ (ARAL learners × school days). School days are Monday to Friday, minus the grade's holidays. Late does not count as present.",
      "A week belongs to the month its Monday falls in. Weeks that have not started yet are not counted.",
    ],
    gaps: ["Attendance is recorded only for ARAL learners; there is no attendance record for other learners."],
    sections: [
      buildSection({
        ...common,
        id: "weekly",
        title: "Attendance rate per week",
        kind: "rate",
        byGrade: false,
        buckets: weeks.map((w) => ({ id: w, label: weekLabel(w) })),
        rows: weekly,
        baseLabel: "Count = days present; base = possible attendance days; % = attendance rate",
      }),
      buildSection({
        ...common,
        id: "monthly",
        title: "Attendance rate per month",
        kind: "rate",
        byGrade: false,
        buckets: months.map((m) => ({ id: m, label: monthLabel(m) })),
        rows: monthly,
        baseLabel: "Count = days present; base = possible attendance days; % = attendance rate",
      }),
    ],
    lists,
    computedAt: args.computedAt,
  };
}
