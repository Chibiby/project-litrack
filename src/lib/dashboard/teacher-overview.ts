import "server-only";
import { prisma } from "@/lib/prisma";
import { cachedQuery } from "@/lib/cache/unstable";
import { teacherDashboard } from "@/lib/cache/tags";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import {
  teacherGradeFilter,
  teacherLearnerFilter,
  weekBounds,
  monthBounds,
  type TeacherOpts,
} from "@/lib/dashboard/aggregates";

/**
 * Everything the teacher dashboard renders, in one cached snapshot.
 *
 * The dashboard's layout is fixed by an approved design: four stat cards, an
 * attendance panel, a reading-level panel, a grade-distribution chart, a task
 * list and quick actions. This module supplies exactly those figures and no
 * more, so every panel on the page is a projection of a single read and the
 * numbers cannot disagree with one another.
 *
 * Two facts about this product shape the queries:
 *
 *  - It is pilot-stage. Most schools have zero `ReadingLevelRecord` rows, so
 *    every ratio here is written to be honest at a zero denominator.
 *  - There is no lock, deadline, or submission model in the schema. Task due
 *    dates below are derived from the calendar cadence the program actually
 *    runs on (attendance weekly, reading level monthly), never from a stored
 *    deadline, and nothing here reports a record as "locked".
 */

export type BandCount = { key: string; label: string; value: number };

export type TeacherOverview = {
  /** Local Manila civil date the whole page is keyed to. */
  today: Date;
  weekStartKey: string;
  monthStartKey: string;

  gradeCount: number;
  totalLearners: number;
  aralLearners: number;
  pendingAralProfiles: number;

  attendance: {
    present: number;
    late: number;
    absent: number;
    excused: number;
    noClass: number;
    totalMarks: number;
    /** Present ÷ every session that should have been marked so far. */
    presentRate: number;
  };

  reading: {
    completed: number;
    pending: number;
    notAssessed: number;
    submitted: number;
    completionRate: number;
  };

  /** One entry per grade level in the school, in school order. */
  gradeDistribution: { name: string; value: number }[];

  /** Days this week that are school days and still have unmarked learners. */
  attendanceDaysOpen: number;
  attendanceMarksMissing: number;

  schoolYearLabel: string | null;
  /** Deep-link target for ARAL entry; null when there is no single ARAL grade. */
  primaryAralGradeId: string | null;
};

export async function getTeacherOverview(
  opts: TeacherOpts
): Promise<TeacherOverview> {
  const { schoolId, teacherId, isSuperAdmin } = opts;
  const now = schoolToday();
  const { start: weekStart, end: weekEnd, schoolDaysElapsed } = weekBounds(now);
  const { start: monthStart, end: monthEnd } = monthBounds(now);

  return cachedQuery(
    async () => {
      const [grades, schoolGrades, activeYear] = await Promise.all([
        prisma.gradeLevel.findMany({
          where: teacherGradeFilter(opts),
          select: { id: true, type: true },
          orderBy: { createdAt: "asc" },
        }),
        // The chart plots every grade the school runs, not only the teacher's,
        // so a teacher with one grade still sees where their learners sit
        // against the whole school's grade ladder.
        prisma.gradeLevel.findMany({
          where: { schoolId, deletedAt: null },
          select: { id: true, type: true },
          orderBy: { type: "asc" },
        }),
        prisma.schoolYear.findFirst({
          where: { schoolId, isActive: true },
          select: { label: true },
        }),
      ]);

      const gradeIds = grades.map((g) => g.id);
      const careFilter = teacherLearnerFilter(opts);

      const empty: TeacherOverview = {
        today: now,
        weekStartKey: formatLocalDateKey(weekStart),
        monthStartKey: formatLocalDateKey(monthStart),
        gradeCount: grades.length,
        totalLearners: 0,
        aralLearners: 0,
        pendingAralProfiles: 0,
        attendance: {
          present: 0,
          late: 0,
          absent: 0,
          excused: 0,
          noClass: 0,
          totalMarks: 0,
          presentRate: 0,
        },
        reading: {
          completed: 0,
          pending: 0,
          notAssessed: 0,
          submitted: 0,
          completionRate: 0,
        },
        gradeDistribution: schoolGrades.map((g) => ({ name: g.type, value: 0 })),
        attendanceDaysOpen: 0,
        attendanceMarksMissing: 0,
        schoolYearLabel: activeYear?.label ?? null,
        primaryAralGradeId: null,
      };

      if (gradeIds.length === 0) return empty;

      const learnerWhere = {
        gradeLevelId: { in: gradeIds },
        deletedAt: null,
        archivedAt: null,
        ...careFilter,
      };

      const [
        totalLearners,
        aralLearners,
        pendingAralProfiles,
        attendanceGroups,
        readingAssessed,
        readingSubmitted,
        perGrade,
        aralGradeRows,
      ] = await Promise.all([
        prisma.learner.count({ where: learnerWhere }),
        prisma.learner.count({ where: { ...learnerWhere, isAralLearner: true } }),
        prisma.learner.count({
          where: { ...learnerWhere, isAralLearner: true, aralProfile: null },
        }),
        prisma.attendance.groupBy({
          by: ["status"],
          where: {
            date: { gte: weekStart, lt: weekEnd },
            learner: {
              gradeLevelId: { in: gradeIds },
              deletedAt: null,
              ...careFilter,
            },
          },
          _count: { _all: true },
        }),
        prisma.readingLevelRecord
          .groupBy({
            by: ["learnerId"],
            where: {
              weekStart: { gte: monthStart, lt: monthEnd },
              learner: {
                gradeLevelId: { in: gradeIds },
                deletedAt: null,
                isAralLearner: true,
                ...careFilter,
              },
            },
          })
          .then((rows) => rows.length),
        prisma.readingLevelRecord.count({
          where: {
            weekStart: { gte: monthStart, lt: monthEnd },
            learner: {
              gradeLevelId: { in: gradeIds },
              deletedAt: null,
              isAralLearner: true,
              ...careFilter,
            },
          },
        }),
        prisma.learner.groupBy({
          by: ["gradeLevelId"],
          where: {
            deletedAt: null,
            archivedAt: null,
            gradeLevelId: { in: schoolGrades.map((g) => g.id) },
            ...careFilter,
          },
          _count: { _all: true },
        }),
        prisma.learner.groupBy({
          by: ["gradeLevelId"],
          where: { ...learnerWhere, isAralLearner: true },
          _count: { _all: true },
        }),
      ]);

      const byStatus = new Map(
        attendanceGroups.map((g) => [g.status, g._count._all])
      );
      const present = byStatus.get("PRESENT") ?? 0;
      const late = byStatus.get("LATE") ?? 0;
      const absent = byStatus.get("ABSENT") ?? 0;
      const excused = byStatus.get("EXCUSED") ?? 0;
      const totalMarks = present + late + absent + excused;

      // Sessions that should exist by now but carry no record at all.
      const expected = aralLearners * schoolDaysElapsed;
      const noClass = Math.max(expected - totalMarks, 0);
      const denominator = totalMarks + noClass;

      const completed = readingAssessed;
      const pending = Math.max(aralLearners - completed, 0);

      const countByGrade = new Map(
        perGrade.map((g) => [g.gradeLevelId, g._count._all])
      );

      const aralGradeIds = aralGradeRows.map((g) => g.gradeLevelId);

      return {
        today: now,
        weekStartKey: formatLocalDateKey(weekStart),
        monthStartKey: formatLocalDateKey(monthStart),
        gradeCount: grades.length,
        totalLearners,
        aralLearners,
        pendingAralProfiles,
        attendance: {
          present,
          late,
          absent,
          excused,
          noClass,
          totalMarks,
          presentRate:
            denominator > 0 ? Math.round((present / denominator) * 100) : 0,
        },
        reading: {
          completed,
          pending,
          notAssessed: 0,
          submitted: readingSubmitted,
          completionRate:
            aralLearners > 0
              ? Math.round((completed / aralLearners) * 100)
              : 0,
        },
        gradeDistribution: schoolGrades.map((g) => ({
          name: g.type,
          value: countByGrade.get(g.id) ?? 0,
        })),
        attendanceDaysOpen: Math.max(
          schoolDaysElapsed - Math.floor(totalMarks / Math.max(aralLearners, 1)),
          0
        ),
        attendanceMarksMissing: noClass,
        schoolYearLabel: activeYear?.label ?? null,
        primaryAralGradeId:
          aralGradeIds.length === 1 ? aralGradeIds[0] : null,
      };
    },
    {
      keyParts: [
        "teacher-overview-v1",
        schoolId,
        teacherId,
        String(isSuperAdmin),
        formatLocalDateKey(weekStart),
        formatLocalDateKey(monthStart),
      ],
      tags: [teacherDashboard(teacherId)],
      profile: "aggregate",
    }
  );
}

// ─── Task cadence ───────────────────────────────────────────────────────────

export type DashboardTask = {
  id: string;
  label: string;
  /** Second line: the due date, or why there is nothing due. */
  detail: string;
  href: string;
  badge: string | null;
  tone: "amber" | "primary" | "muted";
};

/** Friday of the week that `start` (a Monday) opens. */
export function endOfSchoolWeek(weekStart: Date): Date {
  const d = new Date(weekStart);
  d.setDate(d.getDate() + 4);
  return d;
}

/** Last calendar day of the month `date` falls in. */
export function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

/** Whole days from `from` to `to`; negative once `to` has passed. */
export function daysUntil(from: Date, to: Date): number {
  const ms = 24 * 60 * 60 * 1000;
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / ms);
}

function longDate(date: Date): string {
  return new Intl.DateTimeFormat("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function dueWording(days: number): string {
  if (days < 0) return "overdue";
  if (days === 0) return "due today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

/**
 * The dashboard's task list.
 *
 * Due dates come from the program's cadence — attendance is a Monday-keyed
 * week, reading level is a calendar month — because no deadline is stored
 * anywhere. Nothing here claims a record is locked or submitted; the schema
 * has no such state, and inventing one on a dashboard would tell a teacher a
 * rule the system does not actually enforce.
 */
export function buildDashboardTasks(
  data: TeacherOverview,
  hrefs: { reading: string; attendance: string; reports: string }
): DashboardTask[] {
  const tasks: DashboardTask[] = [];

  const monthEnd = endOfMonth(data.today);
  const weekEnd = endOfSchoolWeek(
    new Date(
      Number(data.weekStartKey.slice(0, 4)),
      Number(data.weekStartKey.slice(5, 7)) - 1,
      Number(data.weekStartKey.slice(8, 10))
    )
  );

  tasks.push({
    id: "reading",
    label: "Complete Monthly Reading Level",
    detail: `Due ${longDate(monthEnd)}`,
    href: hrefs.reading,
    badge:
      data.reading.pending > 0
        ? `${data.reading.pending} pending`
        : data.aralLearners > 0
          ? "Complete"
          : null,
    tone: data.reading.pending > 0 ? "amber" : "muted",
  });

  tasks.push({
    id: "attendance",
    label: "Submit Weekly Attendance",
    detail: `Due ${longDate(weekEnd)}`,
    href: hrefs.attendance,
    badge:
      data.attendance.noClass > 0
        ? dueWording(daysUntil(data.today, weekEnd))
        : data.aralLearners > 0
          ? "Complete"
          : null,
    tone: data.attendance.noClass > 0 ? "primary" : "muted",
  });

  tasks.push({
    id: "reports",
    label: "End of Terms Reports",
    detail:
      data.totalLearners > 0
        ? "Available any time from your roster"
        : "Available once you have learners",
    href: hrefs.reports,
    badge: data.totalLearners > 0 ? "Open" : null,
    tone: "muted",
  });

  return tasks;
}
