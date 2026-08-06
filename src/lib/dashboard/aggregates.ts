import "server-only";
import { prisma } from "@/lib/prisma";
import { READING_PROFILE_LABELS } from "@/lib/constants/enum-labels";

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

/** Super Admin platform aggregates — real Prisma counts only. */
export async function getAdminDashboardStats() {
  const since7 = daysAgo(6);
  const now = new Date();

  const [
    schoolsTotal,
    schoolsActive,
    schoolsInactive,
    schoolHeadCount,
    teacherCount,
    learnerCount,
    aralCount,
    expiredPendingInvites,
    auditRows,
    recentSchools,
  ] = await Promise.all([
    prisma.school.count({ where: { deletedAt: null } }),
    prisma.school.count({ where: { deletedAt: null, isActive: true } }),
    prisma.school.count({ where: { deletedAt: null, isActive: false } }),
    prisma.user.count({ where: { role: "SCHOOL_HEAD", deletedAt: null } }),
    prisma.user.count({ where: { role: "TEACHER", deletedAt: null } }),
    prisma.learner.count({ where: { deletedAt: null } }),
    prisma.learner.count({ where: { deletedAt: null, isAralLearner: true } }),
    prisma.teacherInvite.count({
      where: {
        consumedAt: null,
        revokedAt: null,
        expiresAt: { lt: now },
      },
    }),
    prisma.auditLog.findMany({
      where: { timestamp: { gte: since7 } },
      select: { timestamp: true },
    }),
    prisma.school.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, schoolIdCode: true, isActive: true },
    }),
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
    schoolsTotal,
    schoolsActive,
    schoolsInactive,
    schoolHeadCount,
    teacherCount,
    learnerCount,
    aralCount,
    expiredPendingInvites,
    activityByDay,
    schoolStatus,
    recentSchools,
  };
}

/** School Head tenant aggregates. */
export async function getSchoolHeadDashboardStats(schoolId: string) {
  const since7 = daysAgo(6);

  const [
    learnerCount,
    teacherCount,
    gradeCount,
    sectionCount,
    aralCount,
    activeYear,
    announcements,
    profiledHead,
    attendanceRows,
    learnersWithProfiles,
    recentAudit,
    pendingAralProfiles,
  ] = await Promise.all([
    prisma.learner.count({ where: { schoolId, deletedAt: null, archivedAt: null } }),
    prisma.user.count({ where: { schoolId, role: "TEACHER", deletedAt: null } }),
    prisma.gradeLevel.count({ where: { schoolId, deletedAt: null } }),
    prisma.section.count({ where: { schoolId, deletedAt: null } }),
    prisma.learner.count({
      where: { schoolId, deletedAt: null, archivedAt: null, isAralLearner: true },
    }),
    prisma.schoolYear.findFirst({
      where: { schoolId, isActive: true },
      select: { label: true },
    }),
    prisma.announcement.findMany({
      where: { schoolId, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, title: true, createdAt: true },
    }),
    prisma.user.findFirst({
      where: { schoolId, role: "SCHOOL_HEAD", deletedAt: null },
      select: { profileCompleted: true },
    }),
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

  const englishDistribution: NamedCount[] = Object.keys(READING_PROFILE_LABELS).map(
    (k) => ({ name: labelProfile(k), value: enMap.get(k) ?? 0 })
  );
  const filipinoDistribution: NamedCount[] = Object.keys(READING_PROFILE_LABELS).map(
    (k) => ({ name: labelProfile(k), value: filMap.get(k) ?? 0 })
  );

  const readingProgress = await prisma.readingLevelRecord.groupBy({
    by: ["monthYear"],
    where: { learner: { schoolId, deletedAt: null } },
    _count: { _all: true },
    orderBy: { monthYear: "asc" },
  });

  const readingTrend: NamedCount[] = readingProgress.slice(-6).map((r) => ({
    name: r.monthYear,
    value: r._count._all,
  }));

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

  return {
    learnerCount,
    teacherCount,
    gradeCount,
    sectionCount,
    aralCount,
    activeYear,
    announcements,
    attendanceTrend,
    englishDistribution,
    filipinoDistribution,
    readingTrend,
    recentAudit,
    pendingAralProfiles,
    setupTasks,
  };
}

/** Teacher dashboard aggregates for assigned grades. */
export async function getTeacherDashboardStats(opts: {
  schoolId: string;
  teacherId: string;
  isSuperAdmin: boolean;
}) {
  const { schoolId, teacherId, isSuperAdmin } = opts;

  const gradeFilter = isSuperAdmin
    ? { schoolId, deletedAt: null }
    : { schoolId, deletedAt: null, teachers: { some: { id: teacherId } } };

  const grades = await prisma.gradeLevel.findMany({
    where: gradeFilter,
    include: {
      _count: { select: { learners: { where: { deletedAt: null, archivedAt: null } } } },
      learners: {
        where: { deletedAt: null, archivedAt: null },
        select: {
          id: true,
          isAralLearner: true,
          aralProfile: { select: { id: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const gradeIds = grades.map((g) => g.id);
  const learnerIds = grades.flatMap((g) => g.learners.map((l) => l.id));

  const since7 = daysAgo(6);

  const [attendanceMarked, readingRecords] = await Promise.all([
    learnerIds.length === 0
      ? Promise.resolve(0)
      : prisma.attendance.count({
          where: {
            learnerId: { in: learnerIds },
            date: { gte: since7 },
          },
        }),
    learnerIds.length === 0
      ? Promise.resolve(0)
      : prisma.readingLevelRecord.count({
          where: { learnerId: { in: learnerIds } },
        }),
  ]);

  const totalLearners = grades.reduce((n, g) => n + g._count.learners, 0);
  const aralLearners = grades.reduce(
    (n, g) => n + g.learners.filter((l) => l.isAralLearner).length,
    0
  );
  const pendingAralProfiling = grades.reduce(
    (n, g) =>
      n + g.learners.filter((l) => l.isAralLearner && !l.aralProfile).length,
    0
  );

  const gradeBreakdown: NamedCount[] = grades.map((g) => ({
    name: g.type,
    value: g._count.learners,
  }));

  return {
    grades,
    gradeIds,
    totalLearners,
    aralLearners,
    pendingAralProfiling,
    attendanceMarked,
    readingRecords,
    gradeBreakdown,
  };
}
