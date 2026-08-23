import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/dashboard";
import { TableSectionSkeleton } from "@/components/loading";
import { AralFilterPopover } from "@/components/aral/aral-filter-popover";
import { LearnerPagination } from "@/components/learners/learner-pagination";
import { EnrollToAralDialog } from "@/components/aral/enroll-to-aral-dialog";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { getTeacherShellGrades } from "@/lib/dashboard/aggregates";
import { getGradeSections } from "@/lib/cache/grade-sections";
import { teacherGradeScope, teacherLearnerScope } from "@/lib/teachers/scope";
import {
  listAralTutors,
  type AralTutorOption,
} from "@/lib/teachers/aral-tutor";
import {
  gradeLevelIdWhere,
  parseLearnerListParams,
  sectionIdWhere,
  totalPages,
  type LearnerListGradeFilter,
  type LearnerListSectionFilter,
} from "@/lib/learners/pagination";
import { BookOpen, CalendarDays, Edit3, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

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

async function AralLearnersTable({
  where,
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
  const learners = await prisma.learner.findMany({
    relationLoadStrategy: "join",
    where,
    select: {
      id: true,
      fullName: true,
      age: true,
      gradeLevelId: true,
      section: { select: { id: true, name: true } },
      aralProfile: { select: { id: true, updatedAt: true } },
    },
    orderBy: { fullName: "asc" },
    skip,
    take,
  });

  const pageSearchParams: Record<string, string | undefined> = {
    grade: activeGrade !== "all" ? activeGrade : undefined,
    section: section !== "all" ? section : undefined,
    schoolId: schoolIdParam,
  };

  return (
    <Card>
      <CardContent className="p-0">
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Learner</TableHead>
                <TableHead>Age</TableHead>
                {showGradeColumn && <TableHead>Grade</TableHead>}
                {showSection && <TableHead>Section</TableHead>}
                <TableHead>Profile complete?</TableHead>
                <TableHead>Last update</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {learners.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <Sparkles className="h-3 w-3 text-violet" /> {l.fullName}
                    </span>
                  </TableCell>
                  <TableCell>{l.age}</TableCell>
                  {showGradeColumn && (
                    <TableCell className="text-sm text-muted-foreground">
                      {gradeLabels[l.gradeLevelId] ?? "—"}
                    </TableCell>
                  )}
                  {showSection && (
                    <TableCell className="text-sm text-muted-foreground">
                      {l.section?.name ?? "—"}
                    </TableCell>
                  )}
                  <TableCell>
                    {l.aralProfile ? (
                      <Badge variant="violet">Complete</Badge>
                    ) : (
                      <Badge variant="outline">Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {l.aralProfile?.updatedAt.toLocaleDateString() ?? "—"}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button asChild size="sm">
                      <Link
                        href={`/teacher/aral/${l.gradeLevelId}/learners/${l.id}/update`}
                      >
                        <Edit3 className="h-4 w-4" /> Update Data
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link
                        href={`/teacher/grade/${l.gradeLevelId}/learners/${l.id}`}
                      >
                        Profile
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
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
        title="ARAL Dashboard"
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

  const [gradeSections, enrollCandidates, tutors] = await Promise.all([
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
      ? Promise.resolve([] as AralTutorOption[])
      : listAralTutors(schoolId),
  ]);

  const sectionIds = new Set(gradeSections.map((s) => s.id));
  const section = resolveSection(list.section, sectionIds);

  // ONE count, from the RESOLVED section, and the one `where` the table reuses
  // for its `findMany`. There used to be a second count inside the batch above
  // filtered on the raw `list.section`, so a stale or foreign `?section=` put
  // "0 ARAL learners" in the subtitle above a full, pageable table. A single
  // shared clause makes that disagreement unrepresentable.
  //
  // Deliberately sequential-looking but not a new round trip: `resolveSection`
  // needs `gradeSections`, and the subtitle already blocked on a count before
  // render. The Suspense boundary still covers the `findMany`, which is the
  // slow half.
  const aralWhere: Prisma.LearnerWhereInput = {
    ...gradeLevelIdWhere(activeGrade, assignedGradeIds),
    isAralLearner: true,
    deletedAt: null,
    archivedAt: null,
    ...(isSuperAdmin ? {} : teacherLearnerScope(user.id)),
    ...sectionIdWhere(section),
  };
  const aralCount = await prisma.learner.count({ where: aralWhere });
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
      title="ARAL Dashboard"
      subtitle={`${aralCount} ARAL learner${aralCount === 1 ? "" : "s"}${isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}`}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
    >
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
              tutors={tutors}
              selfId={user.id}
            />
          )}
        </div>
      </div>

      <Suspense fallback={<TableSectionSkeleton rows={8} columns={5} />}>
        <AralLearnersTable
          where={aralWhere}
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
    </AppShell>
  );
}
