import "server-only";
import { prismaFresh } from "@/lib/prisma";
import { cachedQuery } from "@/lib/cache/unstable";
import { schoolDashboard, schoolTeacherTasks } from "@/lib/cache/tags";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { formatListingNameFromRecord } from "@/lib/names";
import {
  classifyDiscrepancies,
  openAralDays,
  type AralWeekFact,
  type DiscrepancyFacts,
} from "@/lib/monitoring/discrepancy-rules";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { getMonday } from "@/lib/utils";
import type { DiscrepancySummary } from "@/lib/monitoring/discrepancy-kinds";

/**
 * Monitoring > Discrepancies — gathering the facts for ONE school.
 *
 * Four reads, whatever the school's size, each carrying `schoolId`. The rules
 * that decide what is a discrepancy are pure (`discrepancy-rules.ts`).
 * `prismaFresh`, because the page shows other people's saves.
 */
async function gatherDiscrepancyFacts(schoolId: string): Promise<DiscrepancyFacts> {
  const db = prismaFresh;
  const userSelect = {
    id: true,
    firstName: true,
    middleName: true,
    lastName: true,
    isActive: true,
    deletedAt: true,
    approvalStatus: true,
    schoolId: true,
  } as const;

  const [learners, sections, activeYear] = await Promise.all([
    db.learner.findMany({
      where: { schoolId, deletedAt: null, archivedAt: null },
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        gradeLevelId: true,
        sectionId: true,
        teacherId: true,
        aralTeacherId: true,
        isAralLearner: true,
        gradeLevel: { select: { type: true } },
        section: { select: { name: true, gradeLevelId: true, adviserId: true, deletedAt: true } },
        teacher: { select: userSelect },
        aralTeacher: { select: userSelect },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    }),
    db.section.findMany({
      where: { schoolId, deletedAt: null, gradeLevel: { deletedAt: null } },
      select: {
        id: true,
        name: true,
        gradeLevel: { select: { type: true } },
        adviser: { select: userSelect },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    db.schoolYear.findFirst({
      where: { schoolId, isActive: true },
      select: { id: true, startDate: true },
    }),
  ]);

  const enrollments = activeYear
    ? await db.enrollment.findMany({
        where: { schoolId, schoolYearId: activeYear.id, status: "ACTIVE" },
        select: { learnerId: true, gradeLevelId: true, sectionId: true },
      })
    : [];

  const aralWeeks = activeYear
    ? await gatherAralWeekFacts(schoolId, formatLocalDateKey(activeYear.startDate))
    : [];

  const gradeLabel = (type: string) =>
    (GRADE_LEVEL_LABELS as Record<string, string>)[type] ?? type;
  const person = (
    u: { firstName: string; middleName: string | null; lastName: string; isActive: boolean; deletedAt: Date | null; approvalStatus: string | null; schoolId: string | null } | null
  ) =>
    u
      ? {
          name: formatListingNameFromRecord(u),
          active:
            u.isActive && u.deletedAt === null && u.approvalStatus === "APPROVED" && u.schoolId === schoolId,
        }
      : null;

  return {
    hasActiveYear: activeYear !== null,
    learners: learners.map((l) => ({
      id: l.id,
      name: formatListingNameFromRecord(l),
      gradeLevelId: l.gradeLevelId,
      gradeLabel: gradeLabel(l.gradeLevel.type),
      sectionId: l.section && l.section.deletedAt === null ? l.sectionId : null,
      sectionName: l.section && l.section.deletedAt === null ? l.section.name : null,
      sectionGradeLevelId: l.section && l.section.deletedAt === null ? l.section.gradeLevelId : null,
      sectionAdviserId: l.section && l.section.deletedAt === null ? l.section.adviserId : null,
      teacherId: l.teacherId,
      teacher: person(l.teacher),
      isAralLearner: l.isAralLearner,
      aralTeacherId: l.aralTeacherId,
      aralTeacher: person(l.aralTeacher),
    })),
    sections: sections.map((s) => ({
      id: s.id,
      name: s.name,
      gradeLabel: gradeLabel(s.gradeLevel.type),
      adviser: person(s.adviser),
    })),
    enrollments,
    aralWeeks,
  };
}

/**
 * Finished weeks of the active school year in which a tutor recorded Weekly
 * Attendance on exactly one day for a grade's ARAL learners. Grouped in SQL,
 * so the read stays one row per such week whatever the school's size; the
 * learner join carries schoolId. A learner counts for their current tutor and
 * grade, the people a School Head would ask to fix the week.
 */
async function gatherAralWeekFacts(schoolId: string, yearStartKey: string): Promise<AralWeekFact[]> {
  const db = prismaFresh;
  const thisMondayKey = formatLocalDateKey(getMonday(schoolToday()));
  const rows = await db.$queryRaw<
    { tutor_id: string; grade_level_id: string; week_start: string; days: number }[]
  >`
    SELECT l."aralTeacherId" AS tutor_id,
           l."gradeLevelId" AS grade_level_id,
           to_char(a."weekStart", 'YYYY-MM-DD') AS week_start,
           COUNT(DISTINCT a."date")::int AS days
    FROM "Attendance" a
    JOIN "Learner" l ON l."id" = a."learnerId"
    WHERE l."schoolId" = ${schoolId}
      AND l."isAralLearner" = true
      AND l."deletedAt" IS NULL
      AND l."archivedAt" IS NULL
      AND l."aralTeacherId" IS NOT NULL
      AND a."date" >= ${yearStartKey}::date
      AND a."weekStart" < ${thisMondayKey}::date
    GROUP BY 1, 2, 3
    HAVING COUNT(DISTINCT a."date") = 1
  `;
  if (rows.length === 0) return [];

  const gradeIds = [...new Set(rows.map((r) => r.grade_level_id))];
  const tutorIds = [...new Set(rows.map((r) => r.tutor_id))];
  const firstWeek = rows.reduce((min, r) => (r.week_start < min ? r.week_start : min), rows[0].week_start);
  const [grades, tutors, holidays] = await Promise.all([
    db.gradeLevel.findMany({ where: { id: { in: gradeIds }, schoolId }, select: { id: true, type: true } }),
    db.user.findMany({
      where: { id: { in: tutorIds } },
      select: { id: true, firstName: true, middleName: true, lastName: true },
    }),
    db.attendanceDayMeta.findMany({
      where: {
        gradeLevelId: { in: gradeIds },
        isHoliday: true,
        date: { gte: dateColumn(firstWeek), lt: dateColumn(thisMondayKey) },
      },
      select: { gradeLevelId: true, date: true },
    }),
  ]);

  const gradeById = new Map(grades.map((g) => [g.id, g.type]));
  const tutorById = new Map(tutors.map((t) => [t.id, formatListingNameFromRecord(t)]));
  const holidayKeys = new Map<string, Set<string>>();
  for (const h of holidays) {
    const set = holidayKeys.get(h.gradeLevelId) ?? new Set<string>();
    set.add(dateColumnKey(h.date));
    holidayKeys.set(h.gradeLevelId, set);
  }

  return rows
    .filter((r) => gradeById.has(r.grade_level_id))
    .map((r) => ({
      tutorId: r.tutor_id,
      tutorName: tutorById.get(r.tutor_id) ?? "Unknown tutor",
      gradeLevelId: r.grade_level_id,
      gradeLabel: (GRADE_LEVEL_LABELS as Record<string, string>)[gradeById.get(r.grade_level_id)!] ?? "",
      weekStartKey: r.week_start,
      recordedDays: r.days,
      openDays: openAralDays(r.week_start, {
        yearStartKey,
        holidayKeys: holidayKeys.get(r.grade_level_id) ?? new Set(),
      }),
    }));
}

/** A @db.Date column value for a YYYY-MM-DD key (Prisma maps DATE to UTC midnight). */
function dateColumn(key: string): Date {
  return new Date(key + "T00:00:00Z");
}

/** The YYYY-MM-DD of a @db.Date column value: its UTC fields are the day. */
function dateColumnKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The Discrepancies summary for a school, from the Data Cache (60 seconds).
 * Busted with the dashboard tag, so learner and teacher changes show at once.
 */
export async function getDiscrepancySummary(schoolId: string): Promise<DiscrepancySummary> {
  return cachedQuery(async () => classifyDiscrepancies(await gatherDiscrepancyFacts(schoolId)), {
    keyParts: ["school-discrepancies-v2", schoolId],
    tags: [schoolTeacherTasks(schoolId), schoolDashboard(schoolId)],
    revalidate: 60,
  });
}
