"use server";

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import {
  parseLearnerListParams,
  sectionIdWhere,
} from "@/lib/learners/pagination";
import { parseLocalDateKey } from "@/lib/date-keys";
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

  const list = parseLearnerListParams({ section: input.section });

  return {
    ok: true,
    learnerWhere: {
      gradeLevelId: grade.id,
      isAralLearner: true,
      deletedAt: null,
      archivedAt: null,
      ...(isSuperAdmin ? {} : teacherLearnerScope(user.id)),
      ...sectionIdWhere(list.section),
    },
  };
}

export type AralAttendanceRecord = {
  learnerId: string;
  status: string;
  notes: string | null;
};

/** Fetch attendance rows for a grade/day without remounting the learner list. */
export async function fetchAralAttendanceForDate(input: {
  gradeId: string;
  dateKey: string;
  section?: string;
  schoolId?: string;
}): Promise<ActionResult<{ records: AralAttendanceRecord[]; isHoliday: boolean }>> {
  const date = parseDateKey(input.dateKey);
  if (!date) return { ok: false, error: "Invalid date" };

  const resolved = await resolveGradeLearnerWhere(input);
  if (!resolved.ok) return resolved;

  const [records, dayMeta] = await Promise.all([
    prisma.attendance.findMany({
      where: {
        date,
        learner: resolved.learnerWhere,
      },
      select: {
        learnerId: true,
        status: true,
        notes: true,
      },
    }),
    prisma.attendanceDayMeta.findUnique({
      where: {
        gradeLevelId_date: { gradeLevelId: input.gradeId, date },
      },
      select: { isHoliday: true },
    }),
  ]);

  return {
    ok: true,
    data: { records, isHoliday: dayMeta?.isHoliday ?? false },
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

/** Fetch reading-level rows for a grade/week without remounting the learner list. */
export async function fetchAralReadingLevelForWeek(input: {
  gradeId: string;
  weekKey: string;
  section?: string;
  schoolId?: string;
}): Promise<ActionResult<{ records: AralReadingLevelRecord[] }>> {
  const parsed = parseDateKey(input.weekKey);
  if (!parsed) return { ok: false, error: "Invalid week" };
  const weekStart = getMonday(parsed);

  const resolved = await resolveGradeLearnerWhere(input);
  if (!resolved.ok) return resolved;

  const records = await prisma.readingLevelRecord.findMany({
    where: {
      weekStart,
      learner: resolved.learnerWhere,
    },
    select: {
      learnerId: true,
      englishProfile: true,
      filipinoProfile: true,
      wordRecognitionLevel: true,
      readingComprehensionLevel: true,
      writingLevel: true,
      notes: true,
    },
  });

  return { ok: true, data: { records } };
}
