import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  CellText,
  NoValue,
  RowActions,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import { EmptyState } from "@/components/dashboard";
import { ListBusyRegion, TableSectionSkeleton } from "@/components/loading";
import { ListNavigationProvider } from "@/components/nav/list-navigation";
import { listKey } from "@/lib/nav/list-params";
import { AralFilterPopover } from "@/components/aral/aral-filter-popover";
import { LearnerPagination } from "@/components/learners/learner-pagination";
import { EnrollToAralDialog } from "@/components/aral/enroll-to-aral-dialog";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { getTeacherShellGrades } from "@/lib/dashboard/aggregates";
import { getGradeSections } from "@/lib/cache/grade-sections";
import { aralLearnerScope, teacherGradeScope } from "@/lib/teachers/scope";
import {
  listAralTeachers,
  type AralTeacherPickOption,
} from "@/lib/teachers/aral-teacher";
import {
  gradeLevelIdWhere,
  parseLearnerListParams,
  sectionIdWhere,
  totalPages,
  type LearnerListGradeFilter,
  type LearnerListSectionFilter,
} from "@/lib/learners/pagination";
import { BookOpen, CalendarDays, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Params that change which rows the ARAL learners table shows — see
 * `listKey`. `schoolId` is deliberately excluded: it is the Super Admin's
 * view-context switch, not a facet of this list, and the Suspense boundary
 * must not re-suspend for it.
 */
export const ARAL_LEARNERS_LIST_KEYS = ["page", "grade", "section"] as const;

interface AralDashboardProps {
  searchParams: Promise<{
    schoolId?: string;
    section?: string;
    page?: string;
    grade?: string;
  }>;
}

function resolveSection(
  section: LearnerListSectionFilter,
  sectionIds: Set<string>
): LearnerListSectionFilter {
  if (section === "all" || section === "none") return section;
  return sectionIds.has(section) ? section : "all";
}

/** One page of the ARAL learners table. */
function fetchAralRows(where: Prisma.LearnerWhereInput, skip: number, take: number) {
  return prisma.learner.findMany({
    relationLoadStrategy: "join",
    where,
    select: {
      id: true,
      fullName: true,
      age: true,
      gradeLevelId: true,
      section: { select: { id: true, name: true } },
    },
    orderBy: { fullName: "asc" },
    skip,
    take,
  });
}

type AralRows = Awaited<ReturnType<typeof fetchAralRows>>;

async function AralLearnersTable({
  where,
  requestedRows,
  requestedSkip,
  totalCount,
  page,
  pages,
  skip,
  take,
  activeGrade,
  schoolIdParam,
  section,
  gradeLabels,
  showGradeColumn,
  showSection,
}: {
  /**
   * Built once by the page and shared with the `learner.count` behind
   * `totalCount`, so the subtitle can never disagree with the rows this table
   * pages through. Rebuilding it here is what let the two drift.
   */
  where: Prisma.LearnerWhereInput;
  /**
   * The page the URL asked for, already in flight beside the count. Used when
   * the count leaves that page in range, which is nearly always; otherwise
   * the clamped page is read here.
   */
  requestedRows: Promise<AralRows> | null;
  requestedSkip: number;
  totalCount: number;
  page: number;
  pages: number;
  skip: number;
  take: number;
  activeGrade: LearnerListGradeFilter;
  schoolIdParam?: string;
  section: LearnerListSectionFilter;
  gradeLabels: Record<string, string>;
  showGradeColumn: boolean;
  showSection: boolean;
}) {
  const learners =
    requestedRows && skip === requestedSkip
      ? await requestedRows
      : await fetchAralRows(where, skip, take);

  const learnerHref = (l: (typeof learners)[number]) =>
    `/teacher/grade/${l.gradeLevelId}/learners/${l.id}`;

  const pageSearchParams: Record<string, string | undefined> = {
    grade: activeGrade !== "all" ? activeGrade : undefined,
    section: section !== "all" ? section : undefined,
    schoolId: schoolIdParam,
  };

  return (
    <Card>
      <CardContent className="p-0">
        <ListBusyRegion
          label="ARAL learners"
          skeleton={<TableSectionSkeleton rows={8} columns={5} showToolbar={false} />}
        >
          {totalCount === 0 ? (
            <div className="p-4">
              <EmptyState
                title={
                  section !== "all" || activeGrade !== "all"
                    ? "No ARAL learners match these filters"
                    : "No ARAL learners"
                }
                description={
                  section !== "all" || activeGrade !== "all"
                    ? "Try another grade or section filter."
                    : "Use Enroll to ARAL to add learners from your grades."
                }
              />
            </div>
          ) : (
            <ResponsiveTable
              table={
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Learner</TableHead>
                      <TableHead numeric>Age</TableHead>
                      {showGradeColumn && <TableHead>Grade</TableHead>}
                      {showSection && <TableHead>Section</TableHead>}
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {learners.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="max-w-72 font-medium">
                          <span className="flex min-w-0 items-center gap-2">
                            <Sparkles className="h-3 w-3 shrink-0 text-aral" aria-hidden />
                            <CellText>{l.fullName}</CellText>
                          </span>
                        </TableCell>
                        <TableCell numeric>{l.age ?? <NoValue />}</TableCell>
                        {showGradeColumn && (
                          <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                            {gradeLabels[l.gradeLevelId] ?? <NoValue />}
                          </TableCell>
                        )}
                        {showSection && (
                          <TableCell className="text-sm text-muted-foreground">
                            {l.section?.name ?? <NoValue />}
                          </TableCell>
                        )}
                        <TableCell>
                          <RowActions>
                            <Button asChild size="sm" variant="outline">
                              <Link href={learnerHref(l)}>View learner</Link>
                            </Button>
                          </RowActions>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              }
              stacked={
                <StackedList aria-label="ARAL learners">
                  {learners.map((l) => (
                    <StackedRow
                      key={l.id}
                      leading={<Sparkles className="h-3 w-3 text-aral" aria-hidden />}
                      title={l.fullName}
                      href={learnerHref(l)}
                      value={
                        l.age !== null && l.age !== undefined ? (
                          <>
                            {l.age}
                            <span className="ml-1 text-xs font-normal text-muted-foreground">yrs</span>
                          </>
                        ) : undefined
                      }
                      meta={
                        showGradeColumn || showSection ? (
                          <span className="truncate">
                            {[
                              showGradeColumn ? gradeLabels[l.gradeLevelId] : null,
                              showSection ? l.section?.name ?? "No section" : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        ) : undefined
                      }
                    />
                  ))}
                </StackedList>
              }
            />
          )}
        </ListBusyRegion>
        <LearnerPagination
          basePath="/teacher/aral"
          page={page}
          totalPages={pages}
          searchParams={pageSearchParams}
        />
      </CardContent>
    </Card>
  );
}

export default async function AralDashboard({
  searchParams,
}: AralDashboardProps) {
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  const list = parseLearnerListParams(sp);
  const schoolId =
    (isSuperAdmin ? sp.schoolId : user.schoolId) ?? user.schoolId;

  if (!schoolId) redirect("/login");

  const shellGrades = await getTeacherShellGrades({
    schoolId,
    teacherId: user.id,
    isSuperAdmin,
  });

  let assignedGrades = shellGrades.map((g) => ({ id: g.id, type: g.type }));
  if (
    list.grade !== "all" &&
    !assignedGrades.some((g) => g.id === list.grade)
  ) {
    const extra = await prisma.gradeLevel.findFirst({
      where: isSuperAdmin
        ? { id: list.grade, schoolId, deletedAt: null }
        : {
            id: list.grade,
            schoolId,
            deletedAt: null,
            ...teacherGradeScope(user.id),
          },
      select: { id: true, type: true },
    });
    if (extra) assignedGrades = [extra, ...assignedGrades];
  }

  if (assignedGrades.length === 0) {
    return (
      <AppShell
        title="ARAL Program"
        role={user.role}
        userName={user.fullName || `${user.firstName} ${user.lastName}`}
        isSuperAdminView={isSuperAdmin && !!sp.schoolId}
      >
        <EmptyState
          title="No grades assigned"
          description="Ask your school head to assign you to a grade level."
        />
      </AppShell>
    );
  }

  const assignedGradeIds = assignedGrades.map((g) => g.id);
  const activeGrade: LearnerListGradeFilter =
    list.grade !== "all" && assignedGradeIds.includes(list.grade)
      ? list.grade
      : "all";

  // Attendance / reading / enroll need a concrete grade — selected, else first.
  const actionGradeId =
    activeGrade !== "all" ? activeGrade : assignedGradeIds[0]!;

  // ONE `where`, from the RESOLVED section, shared by the count and the table's
  // rows. There used to be a second count filtered on the raw `list.section`,
  // so a stale or foreign `?section=` put "0 ARAL learners" in the subtitle
  // above a full, pageable table. A single shared clause makes that
  // disagreement unrepresentable.
  const buildAralWhere = (resolved: LearnerListSectionFilter): Prisma.LearnerWhereInput => ({
    ...gradeLevelIdWhere(activeGrade, assignedGradeIds),
    isAralLearner: true,
    deletedAt: null,
    archivedAt: null,
    ...(isSuperAdmin ? {} : aralLearnerScope(user.id)),
    ...sectionIdWhere(resolved),
  });

  // "all" and "none" resolve to themselves whatever sections the grade has
  // (see `resolveSection`), so with no specific `?section=` — the usual case —
  // the `where` is known now. The count and the requested page of rows then
  // start beside the reads below instead of two round trips after them. A
  // specific section must first be checked against `gradeSections`.
  const sectionKnownNow = list.section === "all" || list.section === "none";
  const earlyWhere = sectionKnownNow ? buildAralWhere(list.section) : null;
  const requestedSkip = (list.page - 1) * list.pageSize;
  // `?page=` is user input; an absurd value must not reach the query as an
  // out-of-range OFFSET, so it takes the table's clamped read instead.
  const requestedRows =
    earlyWhere && requestedSkip < 1_000_000
      ? fetchAralRows(earlyWhere, requestedSkip, list.take)
      : null;
  // Awaited later, inside the table's Suspense boundary. Mark it handled now so
  // a failure while the page is still awaiting other reads is not reported as
  // an unhandled rejection; the table's own await still throws it.
  requestedRows?.catch(() => {});

  const [gradeSections, enrollCandidates, aralTeachers, earlyCount] = await Promise.all([
    getGradeSections({
      schoolId,
      gradeLevelIds: activeGrade === "all" ? assignedGradeIds : [activeGrade],
    }),
    isSuperAdmin
      ? Promise.resolve(
          [] as {
            id: string;
            fullName: string;
            section: { name: string } | null;
          }[]
        )
      : prisma.learner.findMany({
          // Deliberately adviser-only: `enrollLearnersToAral` is a roster write
          // gated on the advisory grade, so the candidate list must match it.
          where: {
            gradeLevelId: actionGradeId,
            teacherId: user.id,
            isAralLearner: false,
            deletedAt: null,
            archivedAt: null,
          },
          select: {
            id: true,
            fullName: true,
            section: { select: { name: true } },
          },
          orderBy: { fullName: "asc" },
        }),
    // Empty for Super Admin for the same reason the candidate list above is:
    // with no learners to enroll, there is nobody to designate.
    isSuperAdmin
      ? Promise.resolve([] as AralTeacherPickOption[])
      : listAralTeachers(schoolId),
    earlyWhere ? prisma.learner.count({ where: earlyWhere }) : null,
  ]);

  const sectionIds = new Set(gradeSections.map((s) => s.id));
  const section = resolveSection(list.section, sectionIds);
  const aralWhere = earlyWhere ?? buildAralWhere(section);
  const aralCount = earlyCount ?? (await prisma.learner.count({ where: aralWhere }));
  const pages = totalPages(aralCount, list.pageSize);
  const page = Math.min(list.page, pages);
  const skip = (page - 1) * list.pageSize;

  const candidates = enrollCandidates.map((l) => ({
    id: l.id,
    fullName: l.fullName,
    sectionName: l.section?.name ?? null,
  }));

  const attendanceQs = new URLSearchParams();
  if (sp.schoolId) attendanceQs.set("schoolId", sp.schoolId);
  const attendanceSuffix = attendanceQs.toString();
  const attendanceHref = `/teacher/aral/${actionGradeId}/attendance${
    attendanceSuffix ? `?${attendanceSuffix}` : ""
  }`;
  const readingHref = `/teacher/aral/${actionGradeId}/reading-level${
    attendanceSuffix ? `?${attendanceSuffix}` : ""
  }`;

  const gradeFilterOptions = assignedGrades.map((g) => ({
    id: g.id,
    label: GRADE_LEVEL_LABELS[g.type] ?? g.type,
  }));
  const gradeLabels = Object.fromEntries(
    gradeFilterOptions.map((g) => [g.id, g.label])
  );
  const showGradeColumn = activeGrade === "all" && assignedGrades.length > 1;
  const showSection = gradeSections.length > 0;

  return (
    <AppShell
      title="ARAL Program"
      subtitle={`${aralCount} ARAL learner${aralCount === 1 ? "" : "s"}${isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}`}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
    >
      {/*
        The provider wraps the filter control as well as the rows, not just the
        Suspense boundary. `useListNavigate` reads ancestor context only, so a
        control rendered as a SIBLING of the provider silently falls back to the
        no-op `NO_PROVIDER` value: it would still navigate, but never raise the
        pending flag, so the grade/section filter would change the list with no
        skeleton and no error. Same reasoning as the profiling page, which wraps
        its tabs and toolbar together with its boundary.
      */}
      <ListNavigationProvider>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <AralFilterPopover
          gradeId={activeGrade}
          grades={gradeFilterOptions}
          section={section}
          sections={gradeSections}
          showSection={showSection}
          schoolId={sp.schoolId}
          allowAllGrades
          gradeAsQueryParam
          basePath="/teacher/aral"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href={attendanceHref}>
              <CalendarDays className="h-4 w-4" />
              Weekly attendance
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={readingHref}>
              <BookOpen className="h-4 w-4" />
              Monthly reading level
            </Link>
          </Button>
          {!isSuperAdmin && (
            <EnrollToAralDialog
              gradeId={actionGradeId}
              candidates={candidates}
              teachers={aralTeachers}
              selfId={user.id}
            />
          )}
        </div>
      </div>

        <Suspense
          key={listKey(sp, ARAL_LEARNERS_LIST_KEYS)}
          fallback={<TableSectionSkeleton rows={8} columns={5} />}
        >
          <AralLearnersTable
            where={aralWhere}
            requestedRows={requestedRows}
            requestedSkip={requestedSkip}
            totalCount={aralCount}
            page={page}
            pages={pages}
            skip={skip}
            take={list.take}
            activeGrade={activeGrade}
            schoolIdParam={sp.schoolId}
            section={section}
            gradeLabels={gradeLabels}
            showGradeColumn={showGradeColumn}
            showSection={showSection}
          />
        </Suspense>
      </ListNavigationProvider>
    </AppShell>
  );
}
