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
import { addMonths } from "@/lib/month-range";
import { teacherGradeScope, teacherLearnerScope } from "@/lib/teachers/scope";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
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
      keyParts: [
        "admin-activity-series-v2",
        // The 7-day window above is `daysAgo(6)`; this is derived from the same
        // helper, so the key can never name a different day than the window it
        // caches. Admin-scoped read — no tenant discriminator exists to carry.
        formatLocalDateKey(daysAgo(0)),
      ],
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
          href: SCHOOL_HEAD_ROUTES.profiling,
        });
      }
      if (!activeYear) {
        setupTasks.push({
          id: "year",
          label: "Set an active school year",
          href: SCHOOL_HEAD_ROUTES.schoolYears,
        });
      }
      if (gradeCount === 0) {
        setupTasks.push({
          id: "grades",
          label: "Create grade levels",
          href: SCHOOL_HEAD_ROUTES.schoolGradeLevels,
        });
      }
      if (gradesNeedingSections > 0) {
        setupTasks.push({
          id: "sections",
          label:
            gradesNeedingSections === 1
              ? "Add sections for a grade with learners"
              : `Add sections for ${gradesNeedingSections} grades with learners`,
          href: SCHOOL_HEAD_ROUTES.schoolGradeLevels,
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
      // `weekStart` holds one anchor per assessment period, not per week — the
      // live writer stores the 1st of the month (`src/lib/actions/reading-level.ts:132-135`).
      // `take: 6` below is what makes the chart correct at any cadence; this
      // floor only caps how much history the scan can reach.
      const readingScanFloor = addMonths(daysAgo(0), -17);

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
            where: {
              learner: { schoolId, deletedAt: null },
              weekStart: { gte: readingScanFloor },
            },
            _count: { _all: true },
            orderBy: { weekStart: "desc" },
            take: 6,
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

      // Queried newest-first so `take: 6` keeps the 6 most recent periods;
      // reversed on a copy so the series still runs oldest to newest.
      const readingTrend: NamedCount[] = [...readingProgress]
        .reverse()
        .map((r) => ({
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
      keyParts: [
        "school-head-charts-v2",
        schoolId,
        // The windows above are derived from `daysAgo`; so is this, so the key
        // can never name a different day than the window it caches.
        formatLocalDateKey(daysAgo(0)),
      ],
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
 *
 * Returns everything the sidebar chrome needs, not just grades: the teacher
 * layout is held to two blocking reads, so the designation that decides whether
 * the account chip says "Teacher" or "ARAL Volunteer" rides along here instead
 * of buying a third await on every /teacher navigation.
 *
 * `advisoryGradeLevelId` — the grade of the section this teacher advises, or
 * `null` — rides along for the same reason. The sidebar needs it to build the
 * "End of Terms Reports" href as a real `/teacher/aral/<gradeId>/terms-reports`
 * URL that a nav item can match, instead of pointing at a resolver route whose
 * redirect target matches nothing and leaves "Dashboard" highlighted. Fetching
 * it per-page would add a third blocking read to every /teacher navigation, so
 * it is a third promise on a query already in flight.
 */
const getTeacherShellContextCached = cache(
  async (schoolId: string, teacherId: string, isSuperAdmin: boolean) => {
    return cachedQuery(
      async () => {
        const opts: TeacherOpts = { schoolId, teacherId, isSuperAdmin };
        // `_count` avoids nesting learner rows; shell only needs hasAral boolean.
        // hasAral counts ARAL learners in *this teacher's* care, so the ARAL nav
        // appears for a designated ARAL teacher and not for a teacher who merely
        // shares a grade with somebody else's ARAL learners.
        const [grades, profile, advisorySection] = await Promise.all([
          prisma.gradeLevel.findMany({
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
          }),
          // A Super Admin impersonating the shell has no TeacherProfile, so skip
          // the read rather than let a miss read as "not a volunteer".
          // `findFirst` over `findUnique` to keep the tenant in the where clause
          // even though userId is unique; TeacherProfile carries no schoolId.
          isSuperAdmin
            ? Promise.resolve(null)
            : prisma.teacherProfile.findFirst({
                where: { userId: teacherId, user: { schoolId } },
                select: { designation: true },
              }),
          // A Super Admin impersonating the shell advises nothing, so skip the
          // read rather than let a miss read as "has an advisory".
          // `deletedAt: null` is load-bearing: `deleteSection` soft-deletes and
          // then nulls the pointer, so without it the nav could offer a link
          // into a section nobody can see. Same filter as `getAdvisoryPlacement`
          // (src/lib/teachers/advisory.ts), which the linked page re-reads —
          // the two must agree or the page refuses a link the sidebar advertises.
          isSuperAdmin
            ? Promise.resolve(null)
            : prisma.section.findFirst({
                where: { adviser: { id: teacherId }, schoolId, deletedAt: null },
                select: { gradeLevelId: true },
              }),
        ]);

        return {
          grades: grades.map((g) => ({
            id: g.id,
            type: g.type,
            hasAral: g._count.learners > 0,
          })),
          designation: profile?.designation ?? null,
          advisoryGradeLevelId: advisorySection?.gradeLevelId ?? null,
        };
      },
      {
        keyParts: [
          "teacher-shell-context-v5",
          schoolId,
          teacherId,
          String(isSuperAdmin),
        ],
        tags: [teacherShell(teacherId)],
        // Shell chrome is structural (grade links + hasAral + designation).
        // Longer TTL reduces layout DB work on soft nav; mutations still bust via
        // teacherShell tag when ARAL presence / assignments / the profile change.
        revalidate: 300,
      }
    );
  }
);

/**
 * Sidebar chrome for a teacher: grade links plus the designation that names the
 * role in the account menu. One cache entry, so callers that need both pay once.
 */
export async function getTeacherShellContext(opts: TeacherOpts) {
  return getTeacherShellContextCached(
    opts.schoolId,
    opts.teacherId,
    opts.isSuperAdmin
  );
}

/** Lightweight grades for AppShell sidebar — no full learner payloads. */
export async function getTeacherShellGrades(opts: TeacherOpts) {
  const { grades } = await getTeacherShellContextCached(
    opts.schoolId,
    opts.teacherId,
    opts.isSuperAdmin
  );
  return grades;
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
