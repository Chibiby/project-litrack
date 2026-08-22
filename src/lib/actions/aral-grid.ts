"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import {
  genderWhere,
  parseLearnerListParams,
  sectionIdWhere,
} from "@/lib/learners/pagination";
import { addDays, formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";
import { monthStartOf, nextMonthStart } from "@/lib/month-range";
import {
  countMonthlyAssessmentProgress,
  type MonthlyAssessmentProgress,
} from "@/lib/aral/reading-level-progress";
import { getMonday } from "@/lib/utils";
import { teacherGradeScope, teacherLearnerScope } from "@/lib/teachers/scope";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateKey(value: unknown): Date | null {
  if (typeof value !== "string" || !DATE_KEY_RE.test(value)) return null;
  return parseLocalDateKey(value);
}

async function resolveGradeLearnerWhere(input: {
  gradeId: string;
  section?: string;
  gender?: string;
  schoolId?: string;
}): Promise<
  | { ok: true; learnerWhere: Prisma.LearnerWhereInput }
  | { ok: false; error: string }
> {
  const user = await requireUser("TEACHER");
  const isSuperAdmin = user.role === "SUPER_ADMIN";

  // Super Admin passes every role check, so branch explicitly: they read any
  // school's grade (impersonation view), a teacher is pinned to their own
  // school and to grades they advise in or track ARAL learners in.
  const gradeFilter: Prisma.GradeLevelWhereInput = isSuperAdmin
    ? { id: input.gradeId, deletedAt: null }
    : {
        id: input.gradeId,
        deletedAt: null,
        schoolId: user.schoolId ?? undefined,
        ...teacherGradeScope(user.id),
      };

  const grade = await prisma.gradeLevel.findFirst({
    where: gradeFilter,
    select: { id: true },
  });
  if (!grade) return { ok: false, error: "Grade not found" };

  const list = parseLearnerListParams({ section: input.section, gender: input.gender });

  return {
    ok: true,
    learnerWhere: {
      gradeLevelId: grade.id,
      isAralLearner: true,
      deletedAt: null,
      archivedAt: null,
      ...(isSuperAdmin ? {} : teacherLearnerScope(user.id)),
      ...sectionIdWhere(list.section),
      ...genderWhere(list.gender),
    },
  };
}

export type AralWeeklyAttendanceRecord = {
  learnerId: string;
  /** Local `YYYY-MM-DD` — never a Date, which a UTC lambda would shift a day. */
  dateKey: string;
  status: string;
  notes: string | null;
};

/** Fetch a grade's attendance for one Monday-keyed week, plus its holidays. */
export async function fetchAralAttendanceForWeek(input: {
  gradeId: string;
  weekKey: string;
  section?: string;
  schoolId?: string;
}): Promise<
  ActionResult<{
    records: AralWeeklyAttendanceRecord[];
    /** Days in this week flagged as a grade-level holiday, as `YYYY-MM-DD`. */
    holidayKeys: string[];
  }>
> {
  const parsed = parseDateKey(input.weekKey);
  if (!parsed) return { ok: false, error: "Invalid week" };
  const weekStart = getMonday(parsed);
  const nextWeekStart = addDays(weekStart, 7);

  const resolved = await resolveGradeLearnerWhere(input);
  if (!resolved.ok) return resolved;

  const [rows, holidays] = await Promise.all([
    prisma.attendance.findMany({
      where: {
        date: { gte: weekStart, lt: nextWeekStart },
        learner: resolved.learnerWhere,
      },
      select: { learnerId: true, date: true, status: true, notes: true },
    }),
    prisma.attendanceDayMeta.findMany({
      where: {
        gradeLevelId: input.gradeId,
        date: { gte: weekStart, lt: nextWeekStart },
        isHoliday: true,
      },
      select: { date: true },
    }),
  ]);

  return {
    ok: true,
    data: {
      records: rows.map((r) => ({
        learnerId: r.learnerId,
        dateKey: formatLocalDateKey(r.date),
        status: r.status,
        notes: r.notes,
      })),
      holidayKeys: holidays.map((h) => formatLocalDateKey(h.date)),
    },
  };
}

export type AralReadingLevelRecord = {
  learnerId: string;
  englishProfile: string;
  filipinoProfile: string;
  wordRecognitionLevel: string | null;
  readingComprehensionLevel: string | null;
  writingLevel: string | null;
  notes: string | null;
};

/**
 * Fetch reading-level rows for a grade and month without remounting the learner
 * list, plus the grade-wide progress figure the panel's banner reads.
 *
 * The query covers the whole month rather than matching the anchor exactly. Rows
 * written by the earlier weekly grid are keyed to arbitrary Mondays, and an exact
 * match on the 1st would make them invisible — a teacher would open August and
 * see an empty grid over data that exists. Reading the range and keeping the
 * latest row per learner prefills from whatever is there; the next save
 * consolidates it onto the month anchor. Nothing is deleted, so the change is
 * lossless in both directions.
 *
 * `records` covers every learner the filter matches, not just the page on screen,
 * because the grid keys its rows by learner id and the page slice is the server's
 * business.
 */
export async function fetchAralReadingLevelForMonth(input: {
  gradeId: string;
  monthKey: string;
  section?: string;
  gender?: string;
  schoolId?: string;
}): Promise<
  ActionResult<{
    records: AralReadingLevelRecord[];
    progress: MonthlyAssessmentProgress;
  }>
> {
  const parsed = parseDateKey(input.monthKey);
  if (!parsed) return { ok: false, error: "Invalid month" };
  const monthStart = monthStartOf(parsed);
  const monthEnd = nextMonthStart(parsed);

  const resolved = await resolveGradeLearnerWhere(input);
  if (!resolved.ok) return resolved;

  const [rows, progress] = await Promise.all([
    prisma.readingLevelRecord.findMany({
      where: {
        weekStart: { gte: monthStart, lt: monthEnd },
        learner: resolved.learnerWhere,
      },
      // Ascending, so the last write for a learner wins the reduce below.
      orderBy: [{ weekStart: "asc" }, { updatedAt: "asc" }],
      select: {
        learnerId: true,
        englishProfile: true,
        filipinoProfile: true,
        wordRecognitionLevel: true,
        readingComprehensionLevel: true,
        writingLevel: true,
        notes: true,
      },
    }),
    countMonthlyAssessmentProgress({
      learnerWhere: resolved.learnerWhere,
      monthStart,
      monthEnd,
    }),
  ]);

  const latest = new Map<string, AralReadingLevelRecord>();
  for (const row of rows) latest.set(row.learnerId, row);

  return { ok: true, data: { records: [...latest.values()], progress } };
}
