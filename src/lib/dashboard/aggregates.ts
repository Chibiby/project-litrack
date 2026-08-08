import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { READING_PROFILE_LABELS } from "@/lib/constants/enum-labels";
import { cachedQuery } from "@/lib/cache/unstable";
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

function labelProfile(key: string): string {
  return (
    READING_PROFILE_LABELS[key as keyof typeof READING_PROFILE_LABELS] ?? key
  );
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
      revalidate: 60,
    }
  );
}

export async function getAdminActivitySeries() {
  return cachedQuery(
    async () => {
      const since7 = daysAgo(6);
      const [auditRows, schoolsActive, schoolsInactive] = await Promise.all([
        prisma.auditLog.findMany({
          where: { timestamp: { gte: since7 } },
          select: { timestamp: true },
        }),
        prisma.school.count({ where: { deletedAt: null, isActive: true } }),
        prisma.school.count({ where: { deletedAt: null, isActive: false } }),
      ]);

      const activityByDay: DayCount[] = [];
      for (let i = 6; i >= 0; i--) {
        const day = daysAgo(i);
        const key = day.toISOString().slice(0, 10);
        const value = auditRows.filter(
          (r) => r.timestamp.toISOString().slice(0, 10) === key
        ).length;
        activityByDay.push({ date: key.slice(5), value });
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
      keyParts: ["admin-activity-series"],
      tags: [adminDashboard],
      revalidate: 60,
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
      revalidate: 60,
    }
  );
}

/** @deprecated Prefer section fetchers; kept as composer for compatibility. */
export async function getAdminDashboardStats() {
  const [metrics, activity, recentSchools] = await Promise.all([
    getAdminMetricCounts(),
    getAdminActivitySeries(),
    getAdminRecentSchools(),
  ]);
  return { ...metrics, ...activity, recentSchools };
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
      revalidate: 60,
    }
  );
}

export async function getSchoolHeadCharts(schoolId: string) {
  return cachedQuery(
    async () => {
      const since7 = daysAgo(6);

      const [attendanceRows, learnersWithProfiles, readingProgress] =
        await Promise.all([
          prisma.attendance.findMany({
            where: {
              date: { gte: since7 },
              learner: { schoolId, deletedAt: null },
            },
            select: { date: true, status: true },
          }),
          prisma.learner.groupBy({
            by: ["englishReadingProfile", "filipinoReadingProfile"],
            where: { schoolId, deletedAt: null, archivedAt: null },
            _count: { _all: true },
          }),
          prisma.readingLevelRecord.groupBy({
            by: ["monthYear"],
            where: { learner: { schoolId, deletedAt: null } },
            _count: { _all: true },
            orderBy: { monthYear: "asc" },
          }),
        ]);

      const attendanceTrend: DayCount[] = [];
      for (let i = 6; i >= 0; i--) {
        const day = daysAgo(i);
        const key = day.toISOString().slice(0, 10);
        const present = attendanceRows.filter(
          (r) =>
            r.date.toISOString().slice(0, 10) === key &&
            (r.status === "PRESENT" || r.status === "LATE")
        ).length;
        attendanceTrend.push({ date: key.slice(5), value: present });
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
        name: r.monthYear,
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
      keyParts: ["school-head-charts", schoolId],
      tags: [schoolDashboard(schoolId)],
      revalidate: 60,
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
      revalidate: 60,
    }
  );
}

/** @deprecated Prefer section fetchers; kept as composer for compatibility. */
export async function getSchoolHeadDashboardStats(schoolId: string) {
  const [metrics, charts, activity] = await Promise.all([
    getSchoolHeadMetricCounts(schoolId),
    getSchoolHeadCharts(schoolId),
    getSchoolHeadRecentActivity(schoolId),
  ]);
  return { ...metrics, ...charts, ...activity };
}

// ─── Teacher section fetchers ───────────────────────────────────────────────

type TeacherOpts = {
  schoolId: string;
  teacherId: string;
  isSuperAdmin: boolean;
};

function teacherGradeFilter(opts: TeacherOpts) {
  return opts.isSuperAdmin
    ? { schoolId: opts.schoolId, deletedAt: null as null }
    : {
        schoolId: opts.schoolId,
        deletedAt: null as null,
        teachers: { some: { id: opts.teacherId } },
      };
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
        const grades = await prisma.gradeLevel.findMany({
          where: teacherGradeFilter(opts),
          select: {
            id: true,
            type: true,
            learners: {
              where: {
                deletedAt: null,
                archivedAt: null,
                isAralLearner: true,
              },
              select: { id: true },
              take: 1,
            },
          },
          orderBy: { createdAt: "asc" },
        });

        return grades.map((g) => ({
          id: g.id,
          type: g.type,
          hasAral: g.learners.length > 0,
        }));
      },
      {
        keyParts: [
          "teacher-shell-grades",
          schoolId,
          teacherId,
          String(isSuperAdmin),
        ],
        tags: [teacherShell(teacherId)],
        revalidate: 60,
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

export async function getTeacherMetricCounts(opts: TeacherOpts) {
  const { schoolId, teacherId, isSuperAdmin } = opts;
  return cachedQuery(
    async () => {
      const grades = await prisma.gradeLevel.findMany({
        where: teacherGradeFilter(opts),
        select: { id: true },
      });
      const gradeIds = grades.map((g) => g.id);
      const since7 = daysAgo(6);
      const learnerBase = {
        gradeLevelId: { in: gradeIds },
        deletedAt: null,
        archivedAt: null,
      };

      const [
        totalLearners,
        aralLearners,
        pendingAralProfiling,
        attendanceMarked,
        readingRecords,
      ] = await Promise.all([
        gradeIds.length === 0
          ? Promise.resolve(0)
          : prisma.learner.count({ where: learnerBase }),
        gradeIds.length === 0
          ? Promise.resolve(0)
          : prisma.learner.count({
              where: { ...learnerBase, isAralLearner: true },
            }),
        gradeIds.length === 0
          ? Promise.resolve(0)
          : prisma.learner.count({
              where: {
                gradeLevelId: { in: gradeIds },
                deletedAt: null,
                archivedAt: null,
                isAralLearner: true,
                aralProfile: null,
              },
            }),
        gradeIds.length === 0
          ? Promise.resolve(0)
          : prisma.attendance.count({
              where: {
                date: { gte: since7 },
                learner: { gradeLevelId: { in: gradeIds }, deletedAt: null },
              },
            }),
        gradeIds.length === 0
          ? Promise.resolve(0)
          : prisma.readingLevelRecord.count({
              where: {
                learner: { gradeLevelId: { in: gradeIds }, deletedAt: null },
              },
            }),
      ]);

      return {
        assignedGradeCount: grades.length,
        totalLearners,
        aralLearners,
        pendingAralProfiling,
        attendanceMarked,
        readingRecords,
      };
    },
    {
      keyParts: [
        "teacher-metric-counts",
        schoolId,
        teacherId,
        String(isSuperAdmin),
      ],
      tags: [teacherDashboard(teacherId)],
      revalidate: 60,
    }
  );
}

/** Returns NamedCount[] of learners per assigned grade. */
export async function getTeacherGradeChart(
  opts: TeacherOpts
): Promise<NamedCount[]> {
  const { schoolId, teacherId, isSuperAdmin } = opts;
  return cachedQuery(
    async () => {
      const grades = await prisma.gradeLevel.findMany({
        where: teacherGradeFilter(opts),
        select: {
          type: true,
          _count: {
            select: {
              learners: { where: { deletedAt: null, archivedAt: null } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      return grades.map((g) => ({
        name: g.type,
        value: g._count.learners,
      }));
    },
    {
      keyParts: [
        "teacher-grade-chart",
        schoolId,
        teacherId,
        String(isSuperAdmin),
      ],
      tags: [teacherDashboard(teacherId)],
      revalidate: 60,
    }
  );
}

export async function getTeacherGradeCards(opts: TeacherOpts) {
  const { schoolId, teacherId, isSuperAdmin } = opts;
  return cachedQuery(
    async () => {
      const grades = await prisma.gradeLevel.findMany({
        where: teacherGradeFilter(opts),
        select: {
          id: true,
          type: true,
          _count: {
            select: {
              learners: { where: { deletedAt: null, archivedAt: null } },
            },
          },
          learners: {
            where: {
              deletedAt: null,
              archivedAt: null,
              isAralLearner: true,
            },
            select: {
              id: true,
              aralProfile: { select: { id: true } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      return grades.map((g) => ({
        id: g.id,
        type: g.type,
        learnerCount: g._count.learners,
        aralCount: g.learners.length,
        needsAralProfiling: g.learners.some((l) => !l.aralProfile),
      }));
    },
    {
      keyParts: [
        "teacher-grade-cards",
        schoolId,
        teacherId,
        String(isSuperAdmin),
      ],
      tags: [teacherDashboard(teacherId)],
      revalidate: 60,
    }
  );
}

/** @deprecated Prefer section fetchers; kept as composer for compatibility. */
export async function getTeacherDashboardStats(opts: TeacherOpts) {
  const [shellGrades, metrics, gradeBreakdown, gradeCards] = await Promise.all([
    getTeacherShellGrades(opts),
    getTeacherMetricCounts(opts),
    getTeacherGradeChart(opts),
    getTeacherGradeCards(opts),
  ]);

  return {
    shellGrades,
    gradeIds: shellGrades.map((g) => g.id),
    ...metrics,
    gradeBreakdown,
    gradeCards,
  };
}
