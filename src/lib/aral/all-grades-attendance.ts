import "server-only";
import type { Prisma, User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getTeacherShellGrades } from "@/lib/dashboard/aggregates";
import { aralLearnerScope } from "@/lib/teachers/scope";
import { formatLocalDateKey } from "@/lib/date-keys";
import type { AralWeeklyAttendanceRecord } from "@/lib/actions/aral-grid";

/**
 * The grades and learners the all-grades Weekly Attendance view covers.
 *
 * Grades: the same list the grade picker shows (`getTeacherShellGrades` — the
 * grades this teacher advises in or tracks ARAL learners in), so "All grades"
 * means exactly the options beside it.
 *
 * Learners: the per-grade page's rule applied to each of those grades — ARAL,
 * not deleted or archived, and for a real teacher only the learners they are
 * the designated ARAL teacher of. Tenancy: a teacher is pinned to their own
 * school; Super Admin (impersonation view) reads the `?schoolId=` school.
 */
export async function allGradesAttendanceScope(
  user: Pick<User, "id" | "role" | "schoolId">,
  schoolIdParam: string | undefined,
  /**
   * One advisory (section id) to narrow to, from `?section=`. Anything else
   * means every learner. A section of another school or teacher only narrows
   * the same scoped `where`, so it can match nothing, never widen it.
   */
  section?: string
): Promise<{
  schoolId: string | null;
  grades: { id: string; type: string }[];
  learnerWhere: Prisma.LearnerWhereInput;
}> {
  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const schoolId = (isSuperAdmin ? schoolIdParam : user.schoolId) ?? null;
  const grades = schoolId
    ? (
        await getTeacherShellGrades({
          schoolId,
          teacherId: user.id,
          isSuperAdmin,
        })
      ).map((g) => ({ id: g.id, type: g.type as string }))
    : [];
  return {
    schoolId,
    grades,
    learnerWhere: {
      // No school, or no grades: match nothing rather than every learner.
      schoolId: schoolId ?? "__none__",
      gradeLevelId: { in: grades.map((g) => g.id) },
      isAralLearner: true,
      deletedAt: null,
      archivedAt: null,
      ...(isSuperAdmin ? {} : aralLearnerScope(user.id)),
      ...(section && section !== "all" && section !== "none" ? { sectionId: section } : {}),
    },
  };
}

/** One week's marks for those learners, and each grade's holidays that week. */
export async function readAllGradesAttendanceWeek(input: {
  learnerWhere: Prisma.LearnerWhereInput;
  gradeIds: string[];
  weekStart: Date;
  nextWeekStart: Date;
}): Promise<{
  records: AralWeeklyAttendanceRecord[];
  holidayKeysByGrade: Record<string, string[]>;
}> {
  const [rows, holidays] = await Promise.all([
    prisma.attendance.findMany({
      where: {
        date: { gte: input.weekStart, lt: input.nextWeekStart },
        learner: input.learnerWhere,
      },
      select: { learnerId: true, date: true, status: true, notes: true },
    }),
    prisma.attendanceDayMeta.findMany({
      where: {
        gradeLevelId: { in: input.gradeIds },
        date: { gte: input.weekStart, lt: input.nextWeekStart },
        isHoliday: true,
      },
      select: { gradeLevelId: true, date: true },
    }),
  ]);

  const holidayKeysByGrade: Record<string, string[]> = {};
  for (const h of holidays) {
    (holidayKeysByGrade[h.gradeLevelId] ??= []).push(formatLocalDateKey(h.date));
  }

  return {
    // Local keys, never `toISOString()` — that shifts the day in UTC+8.
    records: rows.map((r) => ({
      learnerId: r.learnerId,
      dateKey: formatLocalDateKey(r.date),
      status: r.status,
      notes: r.notes,
    })),
    holidayKeysByGrade,
  };
}
