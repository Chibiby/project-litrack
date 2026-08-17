import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import {
  LearnerListClient,
  type LearnerListRow,
} from "@/components/learners/learner-list-client";
import { LearnerStatCards } from "@/components/learners/learner-stat-cards";
import { LearnerAddMenu } from "@/components/learners/learner-add-menu";
import { EmptyState } from "@/components/dashboard";
import { TableSectionSkeleton } from "@/components/loading";
import { Skeleton } from "@/components/ui/skeleton";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { getTeacherShellGrades } from "@/lib/dashboard/aggregates";
import { teacherGradeScope, teacherLearnerScope } from "@/lib/teachers/scope";
import {
  aralStatusWhere,
  genderWhere,
  gradeLevelIdWhere,
  nameSearchWhere,
  parseLearnerListParams,
  parseLearnerPageSize,
  sectionIdWhere,
  totalPages,
  type LearnerListGradeFilter,
  type LearnerListSectionFilter,
} from "@/lib/learners/pagination";

export const dynamic = "force-dynamic";

interface TeacherLearnersPageProps {
  searchParams: Promise<{
    schoolId?: string;
    page?: string;
    perPage?: string;
    q?: string;
    filter?: string;
    sort?: string;
    section?: string;
    grade?: string;
    gender?: string;
    aralStatus?: string;
  }>;
}

function resolveSection(
  section: LearnerListSectionFilter,
  sectionIds: Set<string>
): LearnerListSectionFilter {
  if (section === "all" || section === "none") return section;
  return sectionIds.has(section) ? section : "all";
}

function learnerListWhere(opts: {
  assignedGradeIds: string[];
  teacherId: string;
  isSuperAdmin: boolean;
  list: ReturnType<typeof parseLearnerListParams>;
  section: LearnerListSectionFilter;
}): Prisma.LearnerWhereInput {
  const { assignedGradeIds, teacherId, isSuperAdmin, list, section } = opts;
  const where: Prisma.LearnerWhereInput = {
    ...gradeLevelIdWhere(list.grade, assignedGradeIds),
    deletedAt: null,
    // Learners in this teacher's care: advisory roster + ARAL designations.
    ...(isSuperAdmin ? {} : teacherLearnerScope(teacherId)),
    ...sectionIdWhere(section),
    ...genderWhere(list.gender),
    ...aralStatusWhere(list.aralStatus),
    ...nameSearchWhere(list.q),
  };

  if (list.filter === "archived") {
    where.archivedAt = { not: null };
  } else {
    where.archivedAt = null;
    if (list.filter === "aral") {
      where.isAralLearner = true;
    }
  }

  return where;
}

/**
 * The add control needs the teacher's sections, which the header should not
 * block on — it streams in beside the title while the heading paints at once.
 */
async function LearnersAddControl({
  schoolId,
  assignedGradeIds,
  defaultGradeId,
  gradeOptions,
}: {
  schoolId: string;
  assignedGradeIds: string[];
  defaultGradeId: string;
  gradeOptions: { id: string; type: string; label: string }[];
}) {
  const sections = await prisma.section.findMany({
    where: {
      schoolId,
      deletedAt: null,
      gradeLevelId: { in: assignedGradeIds },
    },
    select: { id: true, name: true, gradeLevelId: true },
    orderBy: { name: "asc" },
  });

  return (
    <LearnerAddMenu
      gradeLevelId={defaultGradeId}
      grades={gradeOptions}
      sections={sections}
    />
  );
}

async function LearnersBody({
  assignedGrades,
  schoolId,
  teacherId,
  isSuperAdmin,
  schoolIdParam,
  list,
}: {
  assignedGrades: { id: string; type: string }[];
  schoolId: string;
  teacherId: string;
  isSuperAdmin: boolean;
  schoolIdParam?: string;
  list: ReturnType<typeof parseLearnerListParams>;
}) {
  const assignedGradeIds = assignedGrades.map((g) => g.id);
  const activeGrade: LearnerListGradeFilter =
    list.grade !== "all" && assignedGradeIds.includes(list.grade)
      ? list.grade
      : "all";

  const sections = await prisma.section.findMany({
    where: {
      schoolId,
      deletedAt: null,
      gradeLevelId:
        activeGrade === "all" ? { in: assignedGradeIds } : activeGrade,
    },
    select: { id: true, name: true, gradeLevelId: true },
    orderBy: { name: "asc" },
  });

  const sectionIds = new Set(sections.map((s) => s.id));
  const section = resolveSection(list.section, sectionIds);
  const where = learnerListWhere({
    assignedGradeIds,
    teacherId,
    isSuperAdmin,
    list: { ...list, grade: activeGrade },
    section,
  });

  const totalCount = await prisma.learner.count({ where });
  const pages = totalPages(totalCount, list.pageSize);
  const page = Math.min(list.page, pages);
  const skip = (page - 1) * list.pageSize;

  const learners = await prisma.learner.findMany({
    where,
    select: {
      id: true,
      fullName: true,
      age: true,
      gender: true,
      isAralLearner: true,
      archivedAt: true,
      englishReadingProfile: true,
      filipinoReadingProfile: true,
      gradeLevelId: true,
      gradeLevel: { select: { type: true } },
      section: { select: { id: true, name: true } },
      // Presence only — this drives the ARAL STATUS column.
      aralProfile: { select: { id: true } },
    },
    orderBy: { fullName: "asc" },
    skip,
    take: list.take,
  });

  const rows: LearnerListRow[] = learners.map((l) => ({
    id: l.id,
    fullName: l.fullName,
    age: l.age,
    gender: l.gender,
    isAralLearner: l.isAralLearner,
    hasAralProfile: l.aralProfile !== null,
    archivedAt: l.archivedAt ? l.archivedAt.toISOString() : null,
    englishReadingProfile: l.englishReadingProfile,
    filipinoReadingProfile: l.filipinoReadingProfile,
    section: l.section,
    gradeLevelId: l.gradeLevelId,
    gradeType: l.gradeLevel.type,
  }));

  const gradeOptions = assignedGrades.map((g) => ({
    id: g.id,
    label: GRADE_LEVEL_LABELS[g.type] ?? g.type,
  }));

  return (
    <LearnerListClient
      basePath="/teacher/learners"
      grade={activeGrade}
      section={section}
      gender={list.gender}
      aralStatus={list.aralStatus}
      grades={gradeOptions}
      sections={sections.map((s) => ({ id: s.id, name: s.name }))}
      schoolId={schoolIdParam}
      isSuperAdmin={isSuperAdmin}
      learners={rows}
      page={page}
      pageSize={list.pageSize}
      totalCount={totalCount}
      q={list.q}
    />
  );
}

export default async function TeacherLearnersPage({
  searchParams,
}: TeacherLearnersPageProps) {
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  const pageSize = parseLearnerPageSize(sp.perPage);
  const list = parseLearnerListParams(sp, pageSize);
  const schoolId =
    (isSuperAdmin ? sp.schoolId : user.schoolId) ?? user.schoolId;

  if (!schoolId) redirect("/login");

  const shellGrades = await getTeacherShellGrades({
    schoolId,
    teacherId: user.id,
    isSuperAdmin,
  });

  // Redirects may land with ?grade= for a grade not in shell cache yet —
  // still include it when the teacher (or SA) can access it.
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

  const assignedGradeIds = assignedGrades.map((g) => g.id);
  const gradeOptions = assignedGrades.map((g) => ({
    id: g.id,
    type: g.type,
    label: GRADE_LEVEL_LABELS[g.type] ?? g.type,
  }));
  const defaultGradeId =
    list.grade !== "all" && assignedGradeIds.includes(list.grade)
      ? list.grade
      : (assignedGradeIds[0] ?? "");

  return (
    <AppShell
      title="Learners"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
      hideTitle
    >
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between lg:mb-6">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Learners
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage and view all learners in your advisory.
            {isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}
          </p>
        </div>
        {!isSuperAdmin && defaultGradeId ? (
          <Suspense fallback={<Skeleton className="h-9 w-44" />}>
            <LearnersAddControl
              schoolId={schoolId}
              assignedGradeIds={assignedGradeIds}
              defaultGradeId={defaultGradeId}
              gradeOptions={gradeOptions}
            />
          </Suspense>
        ) : null}
      </div>

      {assignedGrades.length === 0 ? (
        <EmptyState
          title="No grades assigned"
          description="Ask your school head to assign you to a grade level."
        />
      ) : (
        <>
          <Suspense fallback={<StatCardRowSkeleton />}>
            <LearnerStatCards
              assignedGradeIds={assignedGradeIds}
              teacherId={user.id}
              isSuperAdmin={isSuperAdmin}
            />
          </Suspense>

          <div className="mt-4">
            <Suspense fallback={<TableSectionSkeleton rows={8} columns={7} />}>
              <LearnersBody
                assignedGrades={assignedGrades}
                schoolId={schoolId}
                teacherId={user.id}
                isSuperAdmin={isSuperAdmin}
                schoolIdParam={sp.schoolId}
                list={list}
              />
            </Suspense>
          </div>
        </>
      )}
    </AppShell>
  );
}

/** Holds the four-card row's height so the table below does not jump on load. */
function StatCardRowSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-[10.5rem] rounded-xl" />
      ))}
    </div>
  );
}
