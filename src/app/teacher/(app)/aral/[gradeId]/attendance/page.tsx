import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Prisma, User } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { AralWeeklyAttendancePanel } from "@/components/aral/aral-weekly-attendance-panel";
import { AralAttendanceSkeleton } from "@/components/loading";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { getTeacherShellGrades } from "@/lib/dashboard/aggregates";
import { getGradeSections } from "@/lib/cache/grade-sections";
import { teacherGradeScope, teacherLearnerScope } from "@/lib/teachers/scope";
import {
  AralEnrollAction,
  AralEnrollActionFallback,
} from "../_enroll-action";
import {
  parseLearnerListParams,
  sectionIdWhere,
} from "@/lib/learners/pagination";
import {
  addDays,
  formatLocalDateKey,
  parseLocalDateKey,
  schoolToday,
} from "@/lib/date-keys";
import { formatWeekRange } from "@/lib/week-range";
import { getMonday } from "@/lib/utils";
import { listActiveUnlockKeys } from "@/lib/unlock/grants";
import { BookOpen, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

type AttendanceSearchParams = {
  schoolId?: string;
  section?: string;
  week?: string;
};

/** Exactly what the 404 gate selects, so the streamed children share its shape. */
type AttendanceGrade = Prisma.GradeLevelGetPayload<{
  select: { id: true; type: true; schoolId: true };
}>;

interface PageProps {
  params: Promise<{ gradeId: string }>;
  searchParams: Promise<AttendanceSearchParams>;
}

export default async function AralGradeWeeklyAttendancePage({
  params,
  searchParams,
}: PageProps) {
  const { gradeId } = await params;
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  const list = parseLearnerListParams(sp);
  // Weeks run Monday–Sunday. Any date in the URL snaps to its Monday so a link
  // shared mid-week opens the same grid as the nav would.
  //
  // The no-param default comes from `schoolToday()`, not `parseLocalDateKey`'s
  // implicit today: that fallback is a bare `new Date()`, and the server runs in
  // UTC, so between 00:00 and 08:00 Manila it resolves to yesterday. On a Monday
  // morning that is a Sunday, and `getMonday` then steps back a full week — the
  // teacher would enter marks against the wrong week without noticing.
  const weekStart = getMonday(
    sp.week ? parseLocalDateKey(sp.week) : schoolToday()
  );
  const weekKey = formatLocalDateKey(weekStart);
  const nextWeekStart = addDays(weekStart, 7);

  // ARAL page: reachable by the grade's adviser or by a teacher who tracks
  // ARAL learners in it (no advisory section needed).
  const gradeFilter: Prisma.GradeLevelWhereInput = isSuperAdmin
    ? { id: gradeId, deletedAt: null }
    : {
        id: gradeId,
        deletedAt: null,
        schoolId: user.schoolId ?? undefined,
        ...teacherGradeScope(user.id),
      };

  // Awaited above the shell on purpose: painting a title and then swapping it
  // for a 404 reads worse than the one query it costs.
  const grade = await prisma.gradeLevel.findFirst({
    where: gradeFilter,
    select: { id: true, type: true, schoolId: true },
  });
  if (!grade) notFound();

  const linkParams = new URLSearchParams();
  if (sp.schoolId) linkParams.set("schoolId", sp.schoolId);
  if (list.section !== "all") linkParams.set("section", list.section);
  const linkSuffix = linkParams.toString();
  const readingHref = `/teacher/aral/${grade.id}/reading-level${
    linkSuffix ? `?${linkSuffix}` : ""
  }`;
  const termsReportsHref = `/teacher/aral/${grade.id}/terms-reports${
    linkSuffix ? `?${linkSuffix}` : ""
  }`;

  return (
    <AppShell
      title={`Weekly Attendance — ${GRADE_LEVEL_LABELS[grade.type]}`}
      subtitle={`Week of ${formatWeekRange(weekKey)}${isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}`}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
      actions={
        <>
          <Button asChild size="sm" variant="outline">
            <Link href={readingHref}>
              <BookOpen className="h-4 w-4" />
              Monthly reading level
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={termsReportsHref}>
              <FileText className="h-4 w-4" />
              End of terms reports
            </Link>
          </Button>
          {!isSuperAdmin && (
            // Its own boundary: the sheet's candidate and tutor lists are two
            // more queries, and the cross-links above have no reason to wait on
            // a control the teacher has not opened yet.
            <Suspense fallback={<AralEnrollActionFallback />}>
              <AralEnrollAction
                gradeId={grade.id}
                schoolId={grade.schoolId}
                teacherId={user.id}
              />
            </Suspense>
          )}
        </>
      }
    >
      <Suspense fallback={<AralAttendanceSkeleton />}>
        <AralWeeklyAttendanceGrid
          user={user}
          grade={grade}
          list={list}
          weekStart={weekStart}
          nextWeekStart={nextWeekStart}
          weekKey={weekKey}
          sp={sp}
          isSuperAdmin={isSuperAdmin}
        />
      </Suspense>
    </AppShell>
  );
}

/** The grid's own roster, marks, holidays, and grade switcher options. */
async function AralWeeklyAttendanceGrid({
  user,
  grade,
  list,
  weekStart,
  nextWeekStart,
  weekKey,
  sp,
  isSuperAdmin,
}: {
  user: User;
  grade: AttendanceGrade;
  list: ReturnType<typeof parseLearnerListParams>;
  weekStart: Date;
  nextWeekStart: Date;
  weekKey: string;
  sp: AttendanceSearchParams;
  isSuperAdmin: boolean;
}) {
  const learnerWhere: Prisma.LearnerWhereInput = {
    gradeLevelId: grade.id,
    isAralLearner: true,
    deletedAt: null,
    archivedAt: null,
    ...(isSuperAdmin ? {} : teacherLearnerScope(user.id)),
    ...sectionIdWhere(list.section),
  };

  const schoolIdForGrades =
    (isSuperAdmin ? sp.schoolId : user.schoolId) ?? grade.schoolId;

  const [gradeSections, learners, attendances, holidays, shellGrades] =
    await Promise.all([
      getGradeSections({
        schoolId: grade.schoolId,
        gradeLevelIds: [grade.id],
      }),
      prisma.learner.findMany({
        where: learnerWhere,
        select: {
          id: true,
          fullName: true,
          sectionId: true,
        },
        orderBy: { fullName: "asc" },
      }),
      prisma.attendance.findMany({
        where: {
          date: { gte: weekStart, lt: nextWeekStart },
          learner: learnerWhere,
        },
        select: {
          learnerId: true,
          date: true,
          status: true,
          notes: true,
        },
      }),
      prisma.attendanceDayMeta.findMany({
        where: {
          gradeLevelId: grade.id,
          date: { gte: weekStart, lt: nextWeekStart },
          isHoliday: true,
        },
        select: { date: true },
      }),
      schoolIdForGrades
        ? getTeacherShellGrades({
            schoolId: schoolIdForGrades,
            teacherId: user.id,
            isSuperAdmin,
          })
        : Promise.resolve([]),
    ]);

  const showSection = gradeSections.length > 0;
  const basePath = `/teacher/aral/${grade.id}/attendance`;
  const grades = shellGrades.map((g) => ({
    id: g.id,
    label: GRADE_LEVEL_LABELS[g.type],
  }));
  // Ensure current grade is listed even if shell query differs (e.g. admin edge).
  if (!grades.some((g) => g.id === grade.id)) {
    grades.unshift({
      id: grade.id,
      label: GRADE_LEVEL_LABELS[grade.type],
    });
  }

  // Section names come from the already-fetched `gradeSections` rather than a
  // relation in the select. Prisma joins a to-one relation for free when it
  // appears in `where`, but selecting through it costs a whole second query —
  // four round trips under PgBouncer, for names this page is holding anyway.
  // The list is this grade's sections, filtered to `deletedAt: null`, which is
  // both where a learner in this grade is placed and what the Section column
  // already offers as options. `deleteSection` nulls `learner.sectionId` in the
  // same transaction, so a soft-deleted section cannot strand a name either.
  const sectionNames = new Map(gradeSections.map((s) => [s.id, s.name]));
  const gridLearners = learners.map((l) => ({
    id: l.id,
    fullName: l.fullName,
    sectionName: (l.sectionId && sectionNames.get(l.sectionId)) ?? null,
  }));

  const existing = attendances.map((a) => ({
    learnerId: a.learnerId,
    // Local key, never `toISOString()` — that shifts the day in UTC+8.
    dateKey: formatLocalDateKey(a.date),
    status: a.status,
    notes: a.notes,
  }));

  // The panel is a client component, so the grant set has to travel as props —
  // the panel computes the lock itself with `lockInfo`, and it must see the
  // same set the server consults or a granted week renders read-only.
  const unlockedWeeks = isSuperAdmin
    ? []
    : [...(await listActiveUnlockKeys(user.id, "ARAL_WEEKLY_ATTENDANCE"))];

  return (
    <AralWeeklyAttendancePanel
      key={`${list.section}:${sp.schoolId ?? ""}`}
      gradeId={grade.id}
      grades={grades}
      basePath={basePath}
      initialWeekKey={weekKey}
      section={list.section}
      sections={gradeSections}
      showSection={showSection}
      schoolId={sp.schoolId}
      learners={gridLearners}
      initialExisting={existing}
      initialHolidayKeys={holidays.map((h) => formatLocalDateKey(h.date))}
      readOnly={isSuperAdmin}
      unlockedWeeks={unlockedWeeks}
    />
  );
}
