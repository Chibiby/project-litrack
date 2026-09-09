import "server-only";
import { prisma } from "@/lib/prisma";
import { teacherLearnerScope } from "@/lib/teachers/scope";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { formatLocalDateKey, parseLocalDateKey, schoolToday } from "@/lib/date-keys";
import { formatWeekRange } from "@/lib/week-range";
import { currentMonthKey, formatMonthLabel, monthStartOf, nextMonthStart } from "@/lib/month-range";
import { getMonday } from "@/lib/utils";
import type { SchoolUser } from "@/lib/auth/session";
import {
  MAX_NAMED_LEARNERS,
  learnerLabel,
  type AssistantScope,
} from "@/lib/assistant/prompt";

/**
 * The only place that decides what data the model is allowed to see.
 *
 * Every query here is filtered twice over: by `schoolId`, and — for a teacher —
 * by `teacherLearnerScope`, the same predicate the roster pages use. That is
 * deliberate belt and braces. Cross-tenant leakage is the worst bug shippable
 * in this app, and this is the one code path that hands school data to a
 * third party, so it does not get to rely on a caller having filtered already.
 *
 * A School Head sees their whole school; a teacher sees only learners in their
 * care. Super Admin holds no school of their own and never reaches here — the
 * caller refuses them a scope rather than inventing one.
 */
export async function buildAssistantScope(user: SchoolUser): Promise<AssistantScope> {
  const today = schoolToday();
  const weekStart = getMonday(today);
  const weekKey = formatLocalDateKey(weekStart);
  const monthKey = currentMonthKey();

  // The tenant filter, and then the personal one. A School Head's scope is the
  // school; a teacher's is their own learners on either axis.
  const learnerWhere = {
    schoolId: user.schoolId,
    deletedAt: null,
    archivedAt: null,
    ...(user.role === "TEACHER" ? teacherLearnerScope(user.id) : {}),
  };

  const [school, learners, attendanceRows, assessedCount, pending] = await Promise.all([
    prisma.school.findUnique({
      where: { id: user.schoolId },
      select: { name: true },
    }),
    prisma.learner.findMany({
      where: learnerWhere,
      select: {
        id: true,
        isAralLearner: true,
        gradeLevel: { select: { type: true } },
        section: { select: { name: true } },
      },
    }),
    prisma.attendance.groupBy({
      by: ["status"],
      where: { weekStart, learner: learnerWhere },
      _count: { _all: true },
    }),
    prisma.learner.count({
      where: {
        ...learnerWhere,
        isAralLearner: true,
        readingLevels: {
          some: {
            weekStart: {
              gte: monthStartOf(parseLocalDateKey(monthKey)),
              lt: nextMonthStart(parseLocalDateKey(monthKey)),
            },
          },
        },
      },
    }),
    prisma.learner.findMany({
      where: { ...learnerWhere, isAralLearner: true, aralProfile: { is: null } },
      // One more than the cap, purely to know whether to say "and more".
      take: MAX_NAMED_LEARNERS + 1,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      select: {
        firstName: true,
        lastName: true,
        gradeLevel: { select: { type: true } },
        section: { select: { name: true } },
      },
    }),
  ]);

  const aralLearners = learners.filter((l) => l.isAralLearner);

  const counts = new Map<string, { gradeLabel: string; sectionName: string | null; count: number }>();
  for (const learner of learners) {
    const gradeLabel = GRADE_LEVEL_LABELS[learner.gradeLevel.type];
    const sectionName = learner.section?.name ?? null;
    const key = `${gradeLabel}|${sectionName ?? ""}`;
    const row = counts.get(key);
    if (row) row.count += 1;
    else counts.set(key, { gradeLabel, sectionName, count: 1 });
  }

  const byStatus = (status: string): number =>
    attendanceRows.find((row) => row.status === status)?._count._all ?? 0;

  const marked = attendanceRows.reduce((total, row) => total + row._count._all, 0);
  // Five school days: the weekly grid dropped Saturday and Sunday, and an
  // "unmarked" figure counted against seven would understate every class.
  const expected = aralLearners.length * 5;

  return {
    role: user.role,
    firstName: user.firstName,
    schoolName: school?.name ?? "your school",
    today: formatLocalDateKey(today),
    currentWeekLabel: formatWeekRange(weekKey),
    currentMonthLabel: formatMonthLabel(monthKey),
    learnerCount: learners.length,
    aralLearnerCount: aralLearners.length,
    breakdown: [...counts.values()].sort(
      (a, b) =>
        a.gradeLabel.localeCompare(b.gradeLabel) ||
        (a.sectionName ?? "").localeCompare(b.sectionName ?? "")
    ),
    attendance:
      marked > 0
        ? {
            weekLabel: formatWeekRange(weekKey),
            present: byStatus("PRESENT"),
            absent: byStatus("ABSENT"),
            late: byStatus("LATE"),
            excused: byStatus("EXCUSED"),
            unmarked: Math.max(0, expected - marked),
          }
        : null,
    readingLevel:
      aralLearners.length > 0
        ? {
            monthLabel: formatMonthLabel(monthKey),
            assessed: assessedCount,
            total: aralLearners.length,
          }
        : null,
    pendingProfiles: pending.slice(0, MAX_NAMED_LEARNERS).map((learner) => ({
      label: learnerLabel(learner.firstName, learner.lastName),
      gradeLabel: GRADE_LEVEL_LABELS[learner.gradeLevel.type],
      sectionName: learner.section?.name ?? null,
    })),
    pendingProfilesTruncated: pending.length > MAX_NAMED_LEARNERS,
  };
}
