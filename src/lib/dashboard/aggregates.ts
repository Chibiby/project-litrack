import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  READING_PROFILE_LABELS,
  labelReadingProfile,
} from "@/lib/constants/enum-labels";
import { cachedQuery } from "@/lib/cache/unstable";
import { formatLocalDateKey } from "@/lib/date-keys";
import { teacherGradeScope, teacherLearnerScope } from "@/lib/teachers/scope";
import {
  adminDashboard,
  schoolsList,
  schoolDashboard,
  teacherDashboard,
  teacherShell,
} from "@/lib/cache/tags";

export type NamedCount = { name: string; value: number };
export type DayCount = { date: string; value: number };

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysAgo(n: number): Date {
  const d = startOfDay(new Date());
  d.setDate(d.getDate() - n);
  return d;
}

/** School-wide charts mix K3 + G4+; use combined slash labels. */
function labelProfile(key: string): string {
  return labelReadingProfile(key);
}

// ─── Admin section fetchers ─────────────────────────────────────────────────

export async function getAdminMetricCounts() {
  return cachedQuery(
    async () => {
      const [
        schoolsTotal,
        schoolsActive,
        schoolsInactive,
        schoolHeadCount,
        teacherCount,
        learnerCount,
        aralCount,
        pendingTeacherApprovals,
      ] = await Promise.all([
        prisma.school.count({ where: { deletedAt: null } }),
        prisma.school.count({ where: { deletedAt: null, isActive: true } }),
        prisma.school.count({ where: { deletedAt: null, isActive: false } }),
        prisma.user.count({ where: { role: "SCHOOL_HEAD", deletedAt: null } }),
        prisma.user.count({ where: { role: "TEACHER", deletedAt: null, isActive: true } }),
        prisma.learner.count({ where: { deletedAt: null } }),
        prisma.learner.count({ where: { deletedAt: null, isAralLearner: true } }),
        prisma.user.count({
          where: {
            role: "TEACHER",
            approvalStatus: "PENDING",
            deletedAt: null,
          },
        }),
      ]);

      return {
        schoolsTotal,
        schoolsActive,
        schoolsInactive,
        schoolHeadCount,
        teacherCount,
        learnerCount,
        aralCount,
        pendingTeacherApprovals,
      };
    },
    {
      keyParts: ["admin-metric-counts"],
      tags: [adminDashboard],
      profile: "aggregate",
    }
  );
}

export async function getAdminActivitySeries() {
  return cachedQuery(
    async () => {
      const since7 = daysAgo(6);
      const [auditByDay, schoolsActive, schoolsInactive] = await Promise.all([
        prisma.$queryRaw<Array<{ day: Date; value: number }>>`
          SELECT (("timestamp" AT TIME ZONE 'UTC')::date) AS day,
                 COUNT(*)::int AS value
          FROM "AuditLog"
          WHERE "timestamp" >= ${since7}
          GROUP BY 1
          ORDER BY 1 ASC
        `,
        prisma.school.count({ where: { deletedAt: null, isActive: true } }),
        prisma.school.count({ where: { deletedAt: null, isActive: false } }),
      ]);

      const countByKey = new Map(
        auditByDay.map((r) => {
          const key =
            r.day instanceof Date
              ? r.day.toISOString().slice(0, 10)
              : String(r.day).slice(0, 10);
          return [key, Number(r.value)] as const;
        })
      );

      const activityByDay: DayCount[] = [];
      for (let i = 6; i >= 0; i--) {
        const day = daysAgo(i);
        const key = day.toISOString().slice(0, 10);
        activityByDay.push({ date: key.slice(5), value: countByKey.get(key) ?? 0 });
      }

      const schoolStatus: NamedCount[] = [
        { name: "Active", value: schoolsActive },
        { name: "Inactive", value: schoolsInactive },
      ];

      return {
        activityByDay,
        schoolStatus,
        schoolsTotal: schoolsActive + schoolsInactive,
      };
    },
    {
      keyParts: ["admin-activity-series-v2"],
      tags: [adminDashboard],
      profile: "aggregate",
    }
  );
}

export async function getAdminRecentSchools() {
  return cachedQuery(
    async () =>
      prisma.school.findMany({
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, name: true, schoolIdCode: true, isActive: true },
      }),
    {
      keyParts: ["admin-recent-schools"],
      tags: [adminDashboard, schoolsList],
      profile: "aggregate",
    }
  );
}

// ─── School Head section fetchers ───────────────────────────────────────────

export async function getSchoolHeadMetricCounts(schoolId: string) {
  return cachedQuery(
    async () => {
      const [
        learnerCount,
        teacherCount,
        gradeCount,
        sectionCount,
        aralCount,
        activeYear,
        profiledHead,
        gradesNeedingSections,
      ] = await Promise.all([
        prisma.learner.count({
          where: { schoolId, deletedAt: null, archivedAt: null },
        }),
        prisma.user.count({
          where: { schoolId, role: "TEACHER", deletedAt: null, isActive: true },
        }),
        prisma.gradeLevel.count({ where: { schoolId, deletedAt: null } }),
        prisma.section.count({ where: { schoolId, deletedAt: null } }),
        prisma.learner.count({
          where: {
            schoolId,
            deletedAt: null,
            archivedAt: null,
            isAralLearner: true,
          },
        }),
        prisma.schoolYear.findFirst({
          where: { schoolId, isActive: true },
          select: { label: true },
        }),
        prisma.user.findFirst({
          where: { schoolId, role: "SCHOOL_HEAD", deletedAt: null },
          select: { profileCompleted: true },
        }),
        // Non-blocking nudge: grades with learners but zero active sections
        prisma.gradeLevel.count({
          where: {
            schoolId,
            deletedAt: null,
            learners: { some: { deletedAt: null } },
            sections: { none: { deletedAt: null } },
          },
        }),
      ]);

      const setupTasks: { id: string; label: string; href: string }[] = [];
      if (!profiledHead?.profileCompleted) {
        setupTasks.push({
          id: "profile",
          label: "Complete School Head profiling",
          href: "/school-head/profiling",
        });
      }
      if (!activeYear) {
        setupTasks.push({
          id: "year",
          label: "Set an active school year",
          href: "/school-head/school-years",
        });
      }
      if (gradeCount === 0) {
        setupTasks.push({
          id: "grades",
          label: "Create grade levels",
          href: "/school-head/grade-levels",
        });
      }
      if (gradesNeedingSections > 0) {
        setupTasks.push({
          id: "sections",
          label:
            gradesNeedingSections === 1
              ? "Add sections for a grade with learners"
              : `Add sections for ${gradesNeedingSections} grades with learners`,
          href: "/school-head/grade-levels",
        });
      }

      return {
        learnerCount,
        teacherCount,
        gradeCount,
        sectionCount,
        aralCount,
        activeYear,
        setupTasks,
      };
    },
    {
      keyParts: ["school-head-metric-counts", schoolId],
      tags: [schoolDashboard(schoolId)],
      profile: "aggregate",
    }
  );
}

export async function getSchoolHeadCharts(schoolId: string) {
  return cachedQuery(
    async () => {
      const since7 = daysAgo(6);

      const [attendanceGrouped, learnersWithProfiles, readingProgress] =
        await Promise.all([
          prisma.attendance.groupBy({
            by: ["date"],
            where: {
              date: { gte: since7 },
              status: { in: ["PRESENT", "LATE"] },
              learner: { schoolId, deletedAt: null },
            },
            _count: { _all: true },
          }),
          prisma.learner.groupBy({
            by: ["englishReadingProfile", "filipinoReadingProfile"],
            where: { schoolId, deletedAt: null, archivedAt: null },
            _count: { _all: true },
          }),
          prisma.readingLevelRecord.groupBy({
            by: ["weekStart"],
            where: { learner: { schoolId, deletedAt: null } },
            _count: { _all: true },
            orderBy: { weekStart: "asc" },
          }),
        ]);

      const presentByDay = new Map(
        attendanceGrouped.map((r) => [
          r.date.toISOString().slice(0, 10),
          r._count._all,
        ])
      );

      const attendanceTrend: DayCount[] = [];
      for (let i = 6; i >= 0; i--) {
        const day = daysAgo(i);
        const key = day.toISOString().slice(0, 10);
        attendanceTrend.push({
          date: key.slice(5),
          value: presentByDay.get(key) ?? 0,
        });
      }

      const enMap = new Map<string, number>();
      const filMap = new Map<string, number>();
      for (const row of learnersWithProfiles) {
        enMap.set(
          row.englishReadingProfile,
          (enMap.get(row.englishReadingProfile) ?? 0) + row._count._all
        );
        filMap.set(
          row.filipinoReadingProfile,
          (filMap.get(row.filipinoReadingProfile) ?? 0) + row._count._all
        );
      }

      const englishDistribution: NamedCount[] = Object.keys(
        READING_PROFILE_LABELS
      ).map((k) => ({ name: labelProfile(k), value: enMap.get(k) ?? 0 }));
      const filipinoDistribution: NamedCount[] = Object.keys(
        READING_PROFILE_LABELS
      ).map((k) => ({ name: labelProfile(k), value: filMap.get(k) ?? 0 }));

      const readingTrend: NamedCount[] = readingProgress.slice(-6).map((r) => ({
        name: r.weekStart.toISOString().slice(0, 10),
        value: r._count._all,
      }));

      return {
        attendanceTrend,
        englishDistribution,
        filipinoDistribution,
        readingTrend,
      };
    },
    {
      keyParts: ["school-head-charts-v2", schoolId],
      tags: [schoolDashboard(schoolId)],
      profile: "aggregate",
    }
  );
}

export async function getSchoolHeadRecentActivity(schoolId: string) {
  return cachedQuery(
    async () => {
      const [announcements, recentAudit, pendingAralProfiles] =
        await Promise.all([
          prisma.announcement.findMany({
            where: { schoolId, deletedAt: null },
            orderBy: { createdAt: "desc" },
            take: 5,
            select: { id: true, title: true, createdAt: true },
          }),
          prisma.auditLog.findMany({
            where: { schoolId },
            orderBy: { timestamp: "desc" },
            take: 8,
            select: { id: true, action: true, resource: true, timestamp: true },
          }),
          prisma.learner.count({
            where: {
              schoolId,
              deletedAt: null,
              isAralLearner: true,
              aralProfile: null,
            },
          }),
        ]);

      return { announcements, recentAudit, pendingAralProfiles };
    },
    {
      keyParts: ["school-head-recent-activity", schoolId],
      tags: [schoolDashboard(schoolId)],
      profile: "aggregate",
    }
  );
}


// ─── Teacher section fetchers ───────────────────────────────────────────────

export type TeacherOpts = {
  schoolId: string;
  teacherId: string;
  isSuperAdmin: boolean;
};

/**
 * Grades a teacher's dashboard/sidebar covers: the grade they advise in (legacy
 * `taughtGrades` mirror + the section they actually advise) unioned with every
 * grade holding a learner they are the designated ARAL teacher of. Without the
 * ARAL branch an ARAL-only teacher resolves to zero grades and every count
 * below silently returns 0.
 */
export function teacherGradeFilter(
  opts: TeacherOpts
): Prisma.GradeLevelWhereInput {
  return opts.isSuperAdmin
    ? { schoolId: opts.schoolId, deletedAt: null }
    : {
        schoolId: opts.schoolId,
        deletedAt: null,
        ...teacherGradeScope(opts.teacherId),
      };
}

/**
 * Learner-level narrowing for a teacher's own numbers.
 *
 * The grade filter above is a visibility union, so counting every learner in
 * those grades would show an ARAL-only teacher the whole grade's roster. Counts
 * are therefore scoped to learners in their care (adviser OR designated ARAL
 * teacher), which is also what `/teacher/learners` lists.
 */
export function teacherLearnerFilter(
  opts: TeacherOpts
): Prisma.LearnerWhereInput {
  return opts.isSuperAdmin ? {} : teacherLearnerScope(opts.teacherId);
}

/**
 * Primitive-keyed inner cache so layout + page dedupe works.
 * React cache() uses referential equality — object opts would miss.
 * Nest: React cache → cachedQuery → prisma (same pattern as getSchoolName).
 */
const getTeacherShellGradesCached = cache(
  async (schoolId: string, teacherId: string, isSuperAdmin: boolean) => {
    return cachedQuery(
      async () => {
        const opts: TeacherOpts = { schoolId, teacherId, isSuperAdmin };
        // `_count` avoids nesting learner rows; shell only needs hasAral boolean.
        // hasAral counts ARAL learners in *this teacher's* care, so the ARAL nav
        // appears for a designated ARAL teacher and not for a teacher who merely
        // shares a grade with somebody else's ARAL learners.
        const grades = await prisma.gradeLevel.findMany({
          where: teacherGradeFilter(opts),
          select: {
            id: true,
            type: true,
            _count: {
              select: {
                learners: {
                  where: {
                    deletedAt: null,
                    archivedAt: null,
                    isAralLearner: true,
                    ...teacherLearnerFilter(opts),
                  },
                },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        });

        return grades.map((g) => ({
          id: g.id,
          type: g.type,
          hasAral: g._count.learners > 0,
        }));
      },
      {
        keyParts: [
          "teacher-shell-grades-v3",
          schoolId,
          teacherId,
          String(isSuperAdmin),
        ],
        tags: [teacherShell(teacherId)],
        // Shell chrome is structural (grade links + hasAral). Longer TTL reduces
        // layout DB work on soft nav; mutations still bust via teacherShell tag
        // when ARAL presence / assignments change.
        revalidate: 300,
      }
    );
  }
);

/** Lightweight grades for AppShell sidebar — no full learner payloads. */
export async function getTeacherShellGrades(opts: TeacherOpts) {
  return getTeacherShellGradesCached(
    opts.schoolId,
    opts.teacherId,
    opts.isSuperAdmin
  );
}

/**
 * Local Monday-start week. `end` is exclusive (next Monday).
 * `schoolDaysElapsed` counts Mon–Fri up to and including today, capped at 5 —
 * the denominator for "expected attendance marks" this week.
 */
export function weekBounds(now: Date): {
  start: Date;
  end: Date;
  schoolDaysElapsed: number;
} {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  // getDay(): Sun=0 … Sat=6. Monday-start offset.
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);

  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  const schoolDaysElapsed = Math.min(offset + 1, 5);
  return { start, end, schoolDaysElapsed };
}

/** Local calendar month; `end` is exclusive (first of next month). */
export function monthBounds(now: Date): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

/** Attendance mix for the current week across the teacher's assigned grades. */
export async function getTeacherAttendanceOverview(opts: TeacherOpts) {
  const { schoolId, teacherId, isSuperAdmin } = opts;
  const { start, end, schoolDaysElapsed } = weekBounds(new Date());

  return cachedQuery(
    async () => {
      const grades = await prisma.gradeLevel.findMany({
        where: teacherGradeFilter(opts),
        select: { id: true },
      });
      const gradeIds = grades.map((g) => g.id);

      const empty = {
        present: 0,
        absent: 0,
        late: 0,
        excused: 0,
        noClass: 0,
        totalMarks: 0,
        presentRate: 0,
      };
      if (gradeIds.length === 0) return empty;

      const careFilter = teacherLearnerFilter(opts);
      const learnerWhere = {
        gradeLevelId: { in: gradeIds },
        deletedAt: null,
        archivedAt: null,
        ...careFilter,
      };

      const [groups, aralLearners] = await Promise.all([
        prisma.attendance.groupBy({
          by: ["status"],
          where: {
            date: { gte: start, lt: end },
            learner: { gradeLevelId: { in: gradeIds }, deletedAt: null, ...careFilter },
          },
          _count: { _all: true },
        }),
        prisma.learner.count({ where: { ...learnerWhere, isAralLearner: true } }),
      ]);

      const byStatus = new Map(groups.map((g) => [g.status, g._count._all]));
      const present = byStatus.get("PRESENT") ?? 0;
      const absent = byStatus.get("ABSENT") ?? 0;
      const late = byStatus.get("LATE") ?? 0;
      const excused = byStatus.get("EXCUSED") ?? 0;
      const totalMarks = present + absent + late + excused;

      // Sessions with no record at all — expected marks minus what was entered.
      const expected = aralLearners * schoolDaysElapsed;
      const noClass = Math.max(expected - totalMarks, 0);
      const denominator = totalMarks + noClass;

      return {
        present,
        absent,
        late,
        excused,
        noClass,
        totalMarks,
        presentRate: denominator > 0 ? Math.round((present / denominator) * 100) : 0,
      };
    },
    {
      keyParts: [
        "teacher-attendance-overview-v1",
        schoolId,
        teacherId,
        String(isSuperAdmin),
        formatLocalDateKey(start),
      ],
      tags: [teacherDashboard(teacherId)],
      profile: "aggregate",
    }
  );
}

/** Monthly reading-level submission progress for ARAL learners. */
export async function getTeacherReadingOverview(opts: TeacherOpts) {
  const { schoolId, teacherId, isSuperAdmin } = opts;
  const { start, end } = monthBounds(new Date());

  return cachedQuery(
    async () => {
      const grades = await prisma.gradeLevel.findMany({
        where: teacherGradeFilter(opts),
        select: { id: true },
      });
      const gradeIds = grades.map((g) => g.id);

      const empty = {
        completed: 0,
        pending: 0,
        notAssessed: 0,
        submitted: 0,
        aralLearners: 0,
        completionRate: 0,
      };
      if (gradeIds.length === 0) return empty;

      const careFilter = teacherLearnerFilter(opts);
      const learnerWhere = {
        gradeLevelId: { in: gradeIds },
        deletedAt: null,
        archivedAt: null,
        ...careFilter,
      };

      const [aralLearners, profiledLearners, distinctAssessed, submitted] =
        await Promise.all([
          prisma.learner.count({ where: { ...learnerWhere, isAralLearner: true } }),
          prisma.learner.count({
            where: { ...learnerWhere, isAralLearner: true, aralProfile: { isNot: null } },
          }),
          prisma.readingLevelRecord
            .groupBy({
              by: ["learnerId"],
              where: {
                weekStart: { gte: start, lt: end },
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
              weekStart: { gte: start, lt: end },
              learner: {
                gradeLevelId: { in: gradeIds },
                deletedAt: null,
                isAralLearner: true,
                ...careFilter,
              },
            },
          }),
        ]);

      const completed = distinctAssessed;
      // Profiled but with no record yet this month.
      const pending = Math.max(profiledLearners - completed, 0);
      // Not even ARAL-profiled, so no assessment can exist.
      const notAssessed = Math.max(aralLearners - profiledLearners, 0);

      return {
        completed,
        pending,
        notAssessed,
        submitted,
        aralLearners,
        completionRate:
          aralLearners > 0 ? Math.round((completed / aralLearners) * 100) : 0,
      };
    },
    {
      keyParts: [
        "teacher-reading-overview-v1",
        schoolId,
        teacherId,
        String(isSuperAdmin),
        formatLocalDateKey(start),
      ],
      tags: [teacherDashboard(teacherId)],
      profile: "aggregate",
    }
  );
}
