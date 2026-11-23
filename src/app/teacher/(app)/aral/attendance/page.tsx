import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { User } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { AttendanceHero } from "@/components/aral/attendance-hero";
import { AralWeeklyAttendancePanel } from "@/components/aral/aral-weekly-attendance-panel";
import { AralAttendanceSkeleton } from "@/components/loading";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { getGradeSections } from "@/lib/cache/grade-sections";
import {
  allGradesAttendanceScope,
  readAllGradesAttendanceWeek,
} from "@/lib/aral/all-grades-attendance";
import { ALL_GRADES_VALUE, gradeSectionLabel } from "@/lib/aral/all-grades";
import { addDays, formatLocalDateKey, parseLocalDateKey, schoolToday } from "@/lib/date-keys";
import { formatWeekRange } from "@/lib/week-range";
import { getMonday } from "@/lib/utils";
import { formatListingNameFromRecord } from "@/lib/names";
import { readUnlockState } from "@/lib/unlock/grants";
import type { GradeLevelType } from "@prisma/client";
import { BookOpen } from "lucide-react";

export const dynamic = "force-dynamic";

type SearchParams = { schoolId?: string; week?: string; section?: string };

/**
 * Weekly Attendance for every grade at once — the default whenever a teacher
 * works in more than one grade. One grid, one week; each save goes to the
 * learner's own grade (see `AralWeeklyAttendanceGridForm`). With one grade or
 * none there is nothing to combine, so the teacher lands on the per-grade page.
 */
export default async function AralAllGradesWeeklyAttendancePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const user = await requireUser("TEACHER");
  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  const scope = await allGradesAttendanceScope(user, sp.schoolId, sp.section);
  if (scope.grades.length <= 1) {
    const only = scope.grades[0];
    const qs = new URLSearchParams();
    if (sp.schoolId) qs.set("schoolId", sp.schoolId);
    if (sp.week) qs.set("week", sp.week);
    if (sp.section) qs.set("section", sp.section);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    redirect(only ? `/teacher/aral/${only.id}/attendance${suffix}` : `/teacher/aral${suffix}`);
  }

  // Same week rule as the per-grade page: snap to Monday, default from the
  // school's today (the server runs in UTC).
  const weekStart = getMonday(sp.week ? parseLocalDateKey(sp.week) : schoolToday());
  const weekKey = formatLocalDateKey(weekStart);
  const subtitle = `Week of ${formatWeekRange(weekKey)}${isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}`;

  // Reading level stays per grade; the first grade is where it opens, and its
  // own picker moves between grades.
  const readingParams = new URLSearchParams();
  if (sp.schoolId) readingParams.set("schoolId", sp.schoolId);
  const readingHref = `/teacher/aral/${scope.grades[0].id}/reading-level${
    readingParams.toString() ? `?${readingParams.toString()}` : ""
  }`;

  return (
    <AppShell
      title="Weekly Attendance — All grades"
      subtitle={subtitle}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
      hideTitle
    >
      <AttendanceHero title="Weekly Attendance — All grades" subtitle={subtitle} />

      <div className="mb-4 flex flex-wrap items-center gap-2 sm:justify-end">
        <Button asChild size="sm" variant="outline">
          <Link href={readingHref}>
            <BookOpen className="h-4 w-4" />
            Monthly reading level
          </Link>
        </Button>
      </div>

      <Suspense fallback={<AralAttendanceSkeleton />}>
        <AllGradesGrid
          user={user}
          scope={scope}
          weekStart={weekStart}
          weekKey={weekKey}
          sp={sp}
          isSuperAdmin={isSuperAdmin}
        />
      </Suspense>
    </AppShell>
  );
}

async function AllGradesGrid({
  user,
  scope,
  weekStart,
  weekKey,
  sp,
  isSuperAdmin,
}: {
  user: User;
  scope: Awaited<ReturnType<typeof allGradesAttendanceScope>>;
  weekStart: Date;
  weekKey: string;
  sp: SearchParams;
  isSuperAdmin: boolean;
}) {
  const gradeIds = scope.grades.map((g) => g.id);
  const [sections, learners, week, unlock] = await Promise.all([
    scope.schoolId
      ? getGradeSections({ schoolId: scope.schoolId, gradeLevelIds: gradeIds })
      : Promise.resolve([]),
    prisma.learner.findMany({
      where: scope.learnerWhere,
      select: {
        id: true,
        fullName: true,
        firstName: true,
        middleName: true,
        lastName: true,
        sectionId: true,
        gradeLevelId: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    }),
    readAllGradesAttendanceWeek({
      learnerWhere: scope.learnerWhere,
      gradeIds,
      weekStart,
      nextWeekStart: addDays(weekStart, 7),
    }),
    // Unlock grants are per teacher and week, not per grade, so one read
    // covers every grade on screen — the save checks the same set.
    isSuperAdmin
      ? Promise.resolve({ lockingEnabled: true, unlockedKeys: new Set<string>() })
      : readUnlockState({
          userId: user.id,
          schoolId: user.schoolId,
          scope: "ARAL_WEEKLY_ATTENDANCE",
        }),
  ]);

  const gradeLabel = new Map(
    scope.grades.map((g) => [g.id, GRADE_LEVEL_LABELS[g.type as GradeLevelType]])
  );
  const sectionNames = new Map(sections.map((s) => [s.id, s.name]));
  const gridLearners = learners.map((l) => ({
    id: l.id,
    fullName: l.fullName,
    listingName: formatListingNameFromRecord(l),
    sectionName: gradeSectionLabel(
      (l.gradeLevelId && gradeLabel.get(l.gradeLevelId)) || "—",
      (l.sectionId && sectionNames.get(l.sectionId)) || null
    ),
    gradeId: l.gradeLevelId ?? undefined,
  }));

  return (
    <AralWeeklyAttendancePanel
      key={`${sp.section ?? "all"}:${sp.schoolId ?? ""}`}
      gradeId={ALL_GRADES_VALUE}
      advisoryGroups={scope.grades.map((g) => ({
        gradeId: g.id,
        gradeLabel: GRADE_LEVEL_LABELS[g.type as GradeLevelType],
        sections: sections.filter((s) => s.gradeLevelId === g.id),
      }))}
      basePath="/teacher/aral/attendance"
      initialWeekKey={weekKey}
      section={sp.section && sp.section !== "none" ? sp.section : "all"}
      showSection
      schoolId={sp.schoolId}
      learners={gridLearners}
      initialExisting={week.records}
      initialHolidayKeys={[]}
      readOnly={isSuperAdmin}
      unlockedWeeks={[...unlock.unlockedKeys]}
      lockingEnabled={unlock.lockingEnabled}
      allGrades={{ holidayKeysByGrade: week.holidayKeysByGrade }}
    />
  );
}
