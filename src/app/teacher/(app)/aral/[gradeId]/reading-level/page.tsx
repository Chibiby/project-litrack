import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { GradeLevelType, Prisma, User } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { AralMonthlyReadingLevelPanel } from "@/components/aral/aral-monthly-reading-level-panel";
import { AralReadingLevelSkeleton } from "@/components/loading";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { getTeacherShellGrades } from "@/lib/dashboard/aggregates";
import { getGradeSections } from "@/lib/cache/grade-sections";
import { teacherGradeScope, teacherLearnerScope } from "@/lib/teachers/scope";
import { countMonthlyAssessmentProgress } from "@/lib/aral/reading-level-progress";
import {
  genderWhere,
  parseLearnerListParams,
  parseLearnerPageSize,
  sectionIdWhere,
  totalPages,
} from "@/lib/learners/pagination";
import { parseLocalDateKey } from "@/lib/date-keys";
import {
  currentMonthKey,
  formatMonthKey,
  formatMonthLabel,
  monthStartOf,
  nextMonthStart,
} from "@/lib/month-range";
import { CalendarCheck, FileText } from "lucide-react";

export const dynamic = "force-dynamic";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The month this page is showing, as its 1st.
 *
 * `?month=` accepts any date in the month so a link built from a plain date key
 * still resolves, and an unparseable value falls back to the current month rather
 * than erroring — a bad query string should not cost a teacher the page.
 */
function resolveMonthKey(raw: string | undefined): string {
  if (!raw || !DATE_KEY_RE.test(raw)) return currentMonthKey();
  return formatMonthKey(parseLocalDateKey(raw));
}

type ReadingLevelSearchParams = {
  schoolId?: string;
  section?: string;
  gender?: string;
  month?: string;
  page?: string;
  perPage?: string;
};

interface PageProps {
  params: Promise<{ gradeId: string }>;
  searchParams: Promise<ReadingLevelSearchParams>;
}

export default async function AralGradeReadingLevelPage({
  params,
  searchParams,
}: PageProps) {
  const { gradeId } = await params;
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  const pageSize = parseLearnerPageSize(sp.perPage);
  const list = parseLearnerListParams(sp, pageSize);
  const monthKey = resolveMonthKey(sp.month);
  const monthStart = monthStartOf(parseLocalDateKey(monthKey));
  const monthEnd = nextMonthStart(monthStart);

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

  // The one query that stays above the shell: it is the 404 gate, and painting a
  // header for a grade the teacher cannot reach only to replace it with a 404 is
  // worse than the short wait. The roster and its records stream in below.
  const grade = await prisma.gradeLevel.findFirst({
    where: gradeFilter,
    select: { id: true, type: true, schoolId: true },
  });
  if (!grade) notFound();

  // Mirrors the attendance page's own cross-link, section filter included: the
  // two pages are one workspace, so a round trip between them must not silently
  // widen the roster the teacher narrowed. Both accept `?section=` for this grade,
  // so the id is always valid at the destination.
  const linkParams = new URLSearchParams();
  if (sp.schoolId) linkParams.set("schoolId", sp.schoolId);
  if (list.section !== "all") linkParams.set("section", list.section);
  const linkSuffix = linkParams.toString();
  const attendanceHref = `/teacher/aral/${grade.id}/attendance${
    linkSuffix ? `?${linkSuffix}` : ""
  }`;
  const termsReportsHref = `/teacher/aral/${grade.id}/terms-reports${
    linkSuffix ? `?${linkSuffix}` : ""
  }`;

  return (
    <AppShell
      title={`Monthly Reading Level — ${GRADE_LEVEL_LABELS[grade.type]}`}
      subtitle={`${formatMonthLabel(monthKey)} assessment${isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}`}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
      actions={
        // The reciprocal of the attendance page's "Monthly reading level", so it
        // sits in the same slot with the same treatment — the pair is one
        // workspace with two views, and a cross-link that moves between the
        // header and the body reads as two unrelated controls.
        <>
          <Button asChild size="sm" variant="outline">
            <Link href={attendanceHref}>
              <CalendarCheck className="h-4 w-4" />
              Weekly attendance
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={termsReportsHref}>
              <FileText className="h-4 w-4" />
              End of terms reports
            </Link>
          </Button>
        </>
      }
    >
      <Suspense fallback={<AralReadingLevelSkeleton />}>
        <AralMonthlyReadingLevelGrid
          user={user}
          grade={grade}
          sp={sp}
          list={list}
          pageSize={pageSize}
          monthKey={monthKey}
          monthStart={monthStart}
          monthEnd={monthEnd}
          isSuperAdmin={isSuperAdmin}
        />
      </Suspense>
    </AppShell>
  );
}

async function AralMonthlyReadingLevelGrid({
  user,
  grade,
  sp,
  list,
  pageSize,
  monthKey,
  monthStart,
  monthEnd,
  isSuperAdmin,
}: {
  user: User;
  grade: { id: string; type: GradeLevelType; schoolId: string };
  sp: ReadingLevelSearchParams;
  list: ReturnType<typeof parseLearnerListParams>;
  pageSize: number;
  monthKey: string;
  monthStart: Date;
  monthEnd: Date;
  isSuperAdmin: boolean;
}) {
  const learnerWhere: Prisma.LearnerWhereInput = {
    gradeLevelId: grade.id,
    isAralLearner: true,
    deletedAt: null,
    archivedAt: null,
    ...(isSuperAdmin ? {} : teacherLearnerScope(user.id)),
    ...sectionIdWhere(list.section),
    ...genderWhere(list.gender),
  };

  const schoolIdForGrades =
    (isSuperAdmin ? sp.schoolId : user.schoolId) ?? grade.schoolId;

  // Two waves, because a roster page cannot be sliced until it is counted:
  // `skip` comes from the clamp below, which needs `totalCount`. So the count
  // leads, everything independent of it rides alongside rather than waiting
  // behind it, and the progress helper is handed the count instead of
  // repeating it.
  const [totalCount, gradeSections, records, shellGrades] = await Promise.all([
    prisma.learner.count({ where: learnerWhere }),
    getGradeSections({
      schoolId: grade.schoolId,
      gradeLevelIds: [grade.id],
    }),
    // Every matching learner's records, not just this page's: the grid keys its
    // rows by learner id, so the wider set costs one small query and no client
    // work. Narrowing it to the visible page would mean waiting for the clamp
    // and then for the roster query to name its ids, turning a query that runs
    // alongside the others into a third wave.
    prisma.readingLevelRecord.findMany({
      where: {
        weekStart: { gte: monthStart, lt: monthEnd },
        learner: learnerWhere,
      },
      // Ascending, so the last row for a learner wins the reduce below.
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
    schoolIdForGrades
      ? getTeacherShellGrades({
          schoolId: schoolIdForGrades,
          teacherId: user.id,
          isSuperAdmin,
        })
      : Promise.resolve([]),
  ]);

  // The pager is sized before the roster query runs, because `?page=` is
  // user-supplied and the filtered set shrinks whenever learners are archived or
  // a filter narrows. Unclamped, `skip` walks past the end: the grid renders
  // "no learners match" while the footer prints "Showing 41 to 7 of 7" and no
  // page button is current. `totalPages` floors at 1, so this never reaches 0.
  // Same clamp the roster page applies for the same reason.
  const pageCount = totalPages(totalCount, pageSize);
  const page = Math.min(list.page, pageCount);
  const skip = (page - 1) * pageSize;

  const [learners, progress] = await Promise.all([
    prisma.learner.findMany({
      where: learnerWhere,
      select: {
        id: true,
        fullName: true,
      },
      orderBy: { fullName: "asc" },
      skip,
      take: pageSize,
    }),
    countMonthlyAssessmentProgress({
      learnerWhere,
      monthStart,
      monthEnd,
      // Already counted above for the pager; the same `where` twice in one
      // request is a wasted round trip.
      total: totalCount,
    }),
  ]);

  // The month is read as a range, not as an equality on its 1st, because rows
  // written by the earlier weekly grid sit on arbitrary Mondays inside it. Keeping
  // the latest row per learner means that data still prefills the grid instead of
  // looking lost; the next save consolidates it onto the month anchor.
  const latestByLearner = new Map<string, (typeof records)[number]>();
  for (const row of records) latestByLearner.set(row.learnerId, row);

  const showSection = gradeSections.length > 0;
  const basePath = `/teacher/aral/${grade.id}/reading-level`;
  const grades = shellGrades.map((g) => ({
    id: g.id,
    label: GRADE_LEVEL_LABELS[g.type],
  }));
  if (!grades.some((g) => g.id === grade.id)) {
    grades.unshift({
      id: grade.id,
      label: GRADE_LEVEL_LABELS[grade.type],
    });
  }

  const gridLearners = learners.map((l) => ({
    id: l.id,
    fullName: l.fullName,
  }));

  return (
    <AralMonthlyReadingLevelPanel
      // Remount when the filtered roster changes: the panel holds the record
      // set and the progress figure in state, and both are filter-scoped.
      key={`${list.section}:${list.gender}:${sp.schoolId ?? ""}`}
      gradeId={grade.id}
      gradeType={grade.type}
      grades={grades}
      basePath={basePath}
      initialMonthKey={monthKey}
      section={list.section}
      sections={gradeSections}
      showSection={showSection}
      gender={list.gender}
      schoolId={sp.schoolId}
      learners={gridLearners}
      initialExisting={[...latestByLearner.values()]}
      initialProgress={progress}
      page={page}
      pageSize={pageSize}
      totalPages={pageCount}
      totalCount={totalCount}
      readOnly={isSuperAdmin}
    />
  );
}
