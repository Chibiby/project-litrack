import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  GRADE_LEVEL_LABELS,
  READING_PROFILE_LABELS,
  labelReadingProfile,
} from "@/lib/constants/enum-labels";
import { IP_ETHNICITIES } from "@/lib/ip/ethnicity";
import { shapeAdminIpMetrics, shapeSchoolIpMetrics } from "@/lib/dashboard/ip-metrics";
import { cachedQuery } from "@/lib/cache/unstable";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { addMonths } from "@/lib/month-range";
import { teacherGradeScope, teacherLearnerScope } from "@/lib/teachers/scope";
import { teacherRosterScope, TEACHER_ROSTER_STATE } from "@/lib/teachers/roster";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { demoSchoolFilter, isDemoEnabled } from "@/lib/settings/system-settings";
import { completeAssessmentWhereForGrades } from "@/lib/reading/policy";
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

/**
 * System-wide counts for the Super Admin dashboard.
 *
 * The demo tenant is excluded while demo mode is off, so the figures an admin
 * reports upward count real schools, real teachers and real learners. Every
 * count is filtered, not only the school ones — a demo School Head inflating
 * `schoolHeadCount` is the same untruth in a smaller font.
 */
export async function getAdminMetricCounts() {
  const demoEnabled = await isDemoEnabled();
  const schoolScope = demoSchoolFilter(demoEnabled);
  // Users and learners reach the flag through their school. No count below
  // includes SUPER_ADMIN, the one role with a null `schoolId`, so filtering
  // through the relation cannot drop a row that should have been counted.
  const viaSchool = demoEnabled ? {} : ({ school: { isDemo: false } } as const);
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
        prisma.school.count({ where: { deletedAt: null, ...schoolScope } }),
        prisma.school.count({ where: { deletedAt: null, isActive: true, ...schoolScope } }),
        prisma.school.count({ where: { deletedAt: null, isActive: false, ...schoolScope } }),
        prisma.user.count({ where: { role: "SCHOOL_HEAD", deletedAt: null, ...viaSchool } }),
        prisma.user.count({
          where: { role: "TEACHER", deletedAt: null, isActive: true, ...viaSchool },
        }),
        prisma.learner.count({ where: { deletedAt: null, ...viaSchool } }),
        prisma.learner.count({ where: { deletedAt: null, isAralLearner: true, ...viaSchool } }),
        prisma.user.count({
          where: {
            role: "TEACHER",
            approvalStatus: "PENDING",
            deletedAt: null,
            ...viaSchool,
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
      keyParts: ["admin-metric-counts", `demo:${demoEnabled}`],
      tags: [adminDashboard],
      profile: "aggregate",
    }
  );
}

export async function getAdminActivitySeries() {
  const demoEnabled = await isDemoEnabled();
  const schoolScope = demoSchoolFilter(demoEnabled);
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
        prisma.school.count({ where: { deletedAt: null, isActive: true, ...schoolScope } }),
        prisma.school.count({ where: { deletedAt: null, isActive: false, ...schoolScope } }),
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
        `demo:${demoEnabled}`,
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
  const demoEnabled = await isDemoEnabled();
  const schoolScope = demoSchoolFilter(demoEnabled);
  return cachedQuery(
    async () =>
      prisma.school.findMany({
        where: { deletedAt: null, ...schoolScope },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, name: true, schoolIdCode: true, isActive: true },
      }),
    {
      keyParts: ["admin-recent-schools", `demo:${demoEnabled}`],
      tags: [adminDashboard, schoolsList],
      profile: "aggregate",
    }
  );
}

// ─── IP learners & learners per advisory teacher ───────────────────────────

/**
 * The learner population both new metrics count: live learners holding an
 * ACTIVE enrollment in an active school year. A learner's ACTIVE enrollment is
 * unique (partial index) and belongs to their school, so grouping by the
 * learner's `schoolId` attributes each one to exactly one school.
 */
const ACTIVE_ENROLLED_LEARNER: Prisma.LearnerWhereInput = {
  deletedAt: null,
  enrollments: { some: { status: "ACTIVE", schoolYear: { isActive: true } } },
};

const IP_LEARNER: Prisma.LearnerWhereInput = {
  OR: [
    { ethnicity: { in: [...IP_ETHNICITIES] } },
    { secondaryEthnicity: { in: [...IP_ETHNICITIES] } },
  ],
};

/**
 * Teachers counted toward the learners-per-teacher denominator: approved,
 * active, live TEACHER-role users, scoped by school. Deliberately includes
 * FLOATING teachers and those with no advisory section — the ratio is
 * learners ÷ every teacher carrying a caseload, not just advisers.
 */
const ACTIVE_TEACHER: Prisma.UserWhereInput = {
  role: "TEACHER",
  approvalStatus: "APPROVED",
  isActive: true,
  deletedAt: null,
};

/**
 * Super Admin: learners per active teacher and IP learners, per school and
 * nationally. Cross-tenant by design (admin-only caller); demo tenant excluded
 * while demo mode is off, like every other admin figure.
 */
export async function getAdminIpAndAdvisoryMetrics() {
  const demoEnabled = await isDemoEnabled();
  const schoolScope = demoSchoolFilter(demoEnabled);
  const viaSchool = demoEnabled ? {} : ({ school: { isDemo: false } } as const);
  return cachedQuery(
    async () => {
      const [schools, learnerTotals, ipRows, teacherTotals] = await Promise.all([
        prisma.school.findMany({
          where: { deletedAt: null, ...schoolScope },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        prisma.learner.groupBy({
          by: ["schoolId"],
          where: { ...ACTIVE_ENROLLED_LEARNER, ...viaSchool },
          _count: { _all: true },
        }),
        prisma.learner.groupBy({
          by: ["schoolId", "ethnicity", "secondaryEthnicity"],
          where: { AND: [ACTIVE_ENROLLED_LEARNER, IP_LEARNER, viaSchool] },
          _count: { _all: true },
        }),
        prisma.user.groupBy({
          by: ["schoolId"],
          where: { ...ACTIVE_TEACHER, ...viaSchool },
          _count: { _all: true },
        }),
      ]);
      return shapeAdminIpMetrics({ schools, learnerTotals, ipRows, teacherTotals });
    },
    {
      keyParts: ["admin-ip-advisory-metrics-v2", `demo:${demoEnabled}`],
      tags: [adminDashboard, schoolsList],
      profile: "aggregate",
    }
  );
}

/** School Head: IP learners in one school, by grade/section and by kind, plus the learners-per-teacher ratio. */
export async function getSchoolHeadIpMetrics(schoolId: string) {
  return cachedQuery(
    async () => {
      const population: Prisma.LearnerWhereInput = {
        ...ACTIVE_ENROLLED_LEARNER,
        schoolId,
      };
      const [grades, sections, totals, ipRows, activeTeachers] = await Promise.all([
        prisma.gradeLevel.findMany({
          where: { schoolId },
          select: { id: true, type: true },
          orderBy: { type: "asc" },
        }),
        prisma.section.findMany({
          where: { schoolId },
          select: { id: true, name: true },
        }),
        prisma.learner.groupBy({
          by: ["gradeLevelId", "sectionId"],
          where: population,
          _count: { _all: true },
        }),
        prisma.learner.groupBy({
          by: ["gradeLevelId", "sectionId", "ethnicity", "secondaryEthnicity"],
          where: { AND: [population, IP_LEARNER] },
          _count: { _all: true },
        }),
        prisma.user.count({ where: { ...ACTIVE_TEACHER, schoolId } }),
      ]);
      return shapeSchoolIpMetrics({
        grades,
        sections,
        gradeLabels: GRADE_LEVEL_LABELS,
        totals,
        ipRows,
        activeTeachers,
      });
    },
    {
      keyParts: ["school-head-ip-metrics-v2", schoolId],
      tags: [schoolDashboard(schoolId)],
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
        pendingTeacherCount,
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
        // Teachers waiting on the head's approve/reject decision. Safe to fold
        // into this cached aggregate (rather than reading it uncached, as
        // originally proposed) now that `revalidateSchoolHeadTeachers` busts
        // `schoolDashboard(schoolId)` on every approve/reject/remove/toggle —
        // see the doc comment on that function in `src/lib/cache/revalidate.ts`.
        // One indexed count against `[schoolId, approvalStatus]` on `User`.
        prisma.user.count({
          where: { ...teacherRosterScope(schoolId), ...TEACHER_ROSTER_STATE.pending },
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
        pendingTeacherCount,
      };
    },
    {
      // `-v2`: gained `pendingTeacherCount`. Bumped so a stale entry from
      // before this change (missing the field) cannot be read as the new
      // shape — same reason `school-head-recent-activity` carries a version.
      keyParts: ["school-head-metric-counts-v2", schoolId],
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
        // `englishReadingProfile` is null for Grade 1/Grade 2 (never collected)
        // and for anyone not yet assessed — neither belongs in a distribution of
        // recorded English bands.
        if (row.englishReadingProfile) {
          enMap.set(
            row.englishReadingProfile,
            (enMap.get(row.englishReadingProfile) ?? 0) + row._count._all
          );
        }
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

/**
 * School-wide weekly attendance mix for the dashboard donut: present / absent /
 * late / excused / not-yet-marked counts across the current Monday-start school
 * week, over every ARAL learner in the school.
 *
 * `Attendance` rows only ever exist for ARAL learners — `markAttendance`
 * (`src/lib/actions/attendance.ts`) refuses to write one for a non-ARAL
 * learner — so this mirrors `getTeacherAttendanceOverview`'s shape exactly
 * (same status buckets, same `noClass`/expected-marks derivation), just
 * school-scoped instead of teacher-scoped, and it is a different fact from
 * `attendanceTrend` above: that is a rolling 7-day present+late count for a
 * line chart, this is a status *mix* for the current calendar week, including
 * absences and not-yet-marked days a trend line never shows. Reusing
 * `attendanceTrend` would report one fact twice under two different windows,
 * not save a query.
 *
 * `weekBounds` takes `schoolToday()`, not `new Date()`, as its anchor — the
 * plain `new Date()` `getTeacherAttendanceOverview` uses resolves to the
 * previous civil day on a UTC-TZ server between 00:00 and 08:00 Manila time
 * (see `schoolToday`'s doc comment in `src/lib/date-keys.ts`); anchoring on
 * the school's own civil day keeps this aggregate correct in that window.
 *
 * Returns raw counts and the denominator only, never a rounded rate, so a
 * school with no ARAL learners this week renders an honest empty ring instead
 * of a false 0%.
 */
export async function getSchoolHeadAttendanceMix(schoolId: string) {
  const { start, end, schoolDaysElapsed } = weekBounds(schoolToday());

  return cachedQuery(
    async () => {
      const [groups, aralLearners] = await Promise.all([
        prisma.attendance.groupBy({
          by: ["status"],
          where: {
            date: { gte: start, lt: end },
            learner: { schoolId, deletedAt: null },
          },
          _count: { _all: true },
        }),
        prisma.learner.count({
          where: { schoolId, deletedAt: null, archivedAt: null, isAralLearner: true },
        }),
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

      return { present, absent, late, excused, noClass, totalMarks, denominator };
    },
    {
      keyParts: ["school-head-attendance-mix-v1", schoolId, formatLocalDateKey(start)],
      tags: [schoolDashboard(schoolId)],
      profile: "aggregate",
    }
  );
}

/**
 * The School Head dashboard's activity rail: announcements, the audit tail, and
 * the count of ARAL learners still missing a profile.
 *
 * Two of the three slices are cached and one deliberately is not, so the two
 * `Promise.all`s below are not redundant: the outer one keeps the uncached read
 * running beside the cached pair instead of behind it, and the inner one is what
 * the cache entry actually holds.
 *
 * `announcements` changes only through actions that call
 * `revalidateSchoolDashboard`, so `schoolDashboard(schoolId)` is a complete
 * invalidation path for it.
 *
 * `recentAudit` is read outside the cache because it has no invalidation path at
 * all. `writeAudit` inserts the row and never revalidates a tag, and some of those
 * inserts are deferred with `after()` — they land *after* the response, so even a
 * `revalidateTag` at the mutation site could not cover them. Cached, this rail
 * would show a School Head their own just-taken action as absent for the whole
 * TTL, on the one surface whose entire job is to say what just happened. Left
 * uncached it is also the cheapest of the three: eight rows off the
 * `(schoolId, timestamp)` order, no joins, no aggregation.
 *
 * `timestamp` therefore stays a real `Date` here, while `announcements[].createdAt`
 * is a JSON string out of the cache. Both consumers pass through `toDateKey`,
 * which is typed `Date | string` for exactly this reason.
 */
export async function getSchoolHeadRecentActivity(schoolId: string) {
  const [cached, recentAudit] = await Promise.all([
    cachedQuery(
      async () => {
        const announcements = await prisma.announcement.findMany({
          where: { schoolId, deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, title: true, createdAt: true },
        });

        return { announcements };
      },
      {
        // `-v3`: the cached value lost `pendingAralProfiles` when the ARAL
        // Profile went dormant. The key parts are otherwise unchanged, so nothing
        // would evict the old two-field entry on its own.
        keyParts: ["school-head-recent-activity-v3", schoolId],
        tags: [schoolDashboard(schoolId)],
        profile: "aggregate",
      }
    ),
    prisma.auditLog.findMany({
      where: { schoolId },
      orderBy: { timestamp: "desc" },
      take: 8,
      select: { id: true, action: true, resource: true, timestamp: true },
    }),
  ]);

  return {
    announcements: cached.announcements,
    recentAudit,
  };
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
 * `advisoryPlacements` — every section this teacher advises, as
 * `{ sectionId, gradeLevelId }`, empty when they advise none — rides along for
 * the same reason: fetching it per-page would add a third blocking read to
 * every /teacher navigation, so it is a third promise on a query already in
 * flight.
 *
 * A LIST, never one grade: multi-advisory lets one teacher hold up to three
 * sections, in one grade or several. `resolveAdvisoryGradeScope`
 * (`src/lib/teachers/advisory.ts`) asks rather than guesses when a grade holds
 * more than one.
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
        const [grades, profile, advisorySections] = await Promise.all([
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
                select: { designation: true, advisoryMode: true },
              }),
          // A Super Admin impersonating the shell advises nothing, so skip the
          // read rather than let a miss read as "has an advisory".
          // `deletedAt: null` is load-bearing: `deleteSection` soft-deletes and
          // then nulls the pointer, so without it the nav could offer a link
          // into a section nobody can see. Same filter as `getAdvisoryPlacement`
          // (src/lib/teachers/advisory.ts), which the linked page re-reads —
          // the two must agree or the page refuses a link the sidebar advertises.
          //
          // `findMany`, not `findFirst`: multi-advisory lets one teacher hold
          // several sections, in several grades, so a nav built from the first of
          // them silently deep-linked every such teacher into one arbitrary class.
          isSuperAdmin
            ? Promise.resolve([] as { id: string; gradeLevelId: string }[])
            : prisma.section.findMany({
                where: { adviserId: teacherId, schoolId, deletedAt: null },
                select: { id: true, gradeLevelId: true },
                orderBy: [{ gradeLevel: { type: "asc" } }, { name: "asc" }],
              }),
        ]);

        return {
          grades: grades.map((g) => ({
            id: g.id,
            type: g.type,
            hasAral: g._count.learners > 0,
          })),
          designation: profile?.designation ?? null,
          advisoryMode: profile?.advisoryMode ?? null,
          // Every advisory this teacher holds, not just the first. Consumers
          // decide for themselves whether one is unambiguous enough to deep-link
          // into — see `advisoryGradeLevelIds` and `resolveAdvisoryGradeScope`.
          advisoryPlacements: advisorySections.map((section) => ({
            sectionId: section.id,
            gradeLevelId: section.gradeLevelId,
          })),
        };
      },
      {
        keyParts: [
          "teacher-shell-context-v7",
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
        select: { id: true, type: true },
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
                // `AND`, not a merged spread: `completeAssessmentWhereForGrades`
                // sets its own `learner` key (to route each row to its grade's
                // language rule), which a plain object spread would clobber
                // against the `learner` key below depending on how many grade
                // shapes it produced.
                AND: [
                  completeAssessmentWhereForGrades(grades),
                  {
                    learner: {
                      gradeLevelId: { in: gradeIds },
                      deletedAt: null,
                      isAralLearner: true,
                      ...careFilter,
                    },
                  },
                ],
              },
            })
            .then((rows) => rows.length),
          // Plain row count meaning "records saved" this month, complete or not —
          // a partial row is still a submission. Deliberately has no profile
          // predicate; do not add COMPLETE_ASSESSMENT_WHERE here.
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
