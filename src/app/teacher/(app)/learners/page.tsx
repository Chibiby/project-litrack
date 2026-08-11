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
import { EmptyState } from "@/components/dashboard";
import { TableSectionSkeleton } from "@/components/loading";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { getTeacherShellGrades } from "@/lib/dashboard/aggregates";
import {
  gradeLevelIdWhere,
  nameSearchWhere,
  parseLearnerListParams,
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
    q?: string;
    filter?: string;
    sort?: string;
    section?: string;
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
    ...(isSuperAdmin ? {} : { teacherId }),
    ...sectionIdWhere(section),
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

async function LearnersHeaderSubtitle({
  assignedGradeIds,
  teacherId,
  isSuperAdmin,
  list,
  section,
  schoolIdParam,
}: {
  assignedGradeIds: string[];
  teacherId: string;
  isSuperAdmin: boolean;
  list: ReturnType<typeof parseLearnerListParams>;
  section: LearnerListSectionFilter;
  schoolIdParam?: string;
}) {
  const gradeClause = gradeLevelIdWhere(list.grade, assignedGradeIds);
  const sectionClause = sectionIdWhere(section);

  const [totalCount, aralCount] = await Promise.all([
    prisma.learner.count({
      where: {
        ...gradeClause,
        deletedAt: null,
        archivedAt: list.filter === "archived" ? { not: null } : null,
        ...(list.filter === "aral" ? { isAralLearner: true } : {}),
        ...(isSuperAdmin ? {} : { teacherId }),
        ...sectionClause,
        ...nameSearchWhere(list.q),
      },
    }),
    prisma.learner.count({
      where: {
        ...gradeClause,
        deletedAt: null,
        archivedAt: null,
        isAralLearner: true,
        ...(isSuperAdmin ? {} : { teacherId }),
      },
    }),
  ]);

  return (
    <p className="text-sm text-muted-foreground">
      {totalCount} learner{totalCount === 1 ? "" : "s"} · {aralCount} ARAL
      {isSuperAdmin && schoolIdParam ? " (Admin View)" : ""}
    </p>
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
        activeGrade === "all"
          ? { in: assignedGradeIds }
          : activeGrade,
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
  const orderBy: Prisma.LearnerOrderByWithRelationInput =
    list.sort === "age" ? { age: "asc" } : { fullName: "asc" };

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
    },
    orderBy,
    skip,
    take: list.take,
  });

  const rows: LearnerListRow[] = learners.map((l) => ({
    id: l.id,
    fullName: l.fullName,
    age: l.age,
    gender: l.gender,
    isAralLearner: l.isAralLearner,
    archivedAt: l.archivedAt ? l.archivedAt.toISOString() : null,
    englishReadingProfile: l.englishReadingProfile,
    filipinoReadingProfile: l.filipinoReadingProfile,
    section: l.section,
    gradeLevelId: l.gradeLevelId,
    gradeType: l.gradeLevel.type,
  }));

  const gradeOptions = assignedGrades.map((g) => ({
    id: g.id,
    type: g.type,
    label: GRADE_LEVEL_LABELS[g.type] ?? g.type,
  }));
  const defaultGradeId =
    activeGrade !== "all" ? activeGrade : (assignedGradeIds[0] ?? "");

  return (
    <LearnerListClient
      basePath="/teacher/learners"
      filter={list.filter}
      sort={list.sort}
      grade={activeGrade}
      section={section}
      grades={gradeOptions.map((g) => ({ id: g.id, label: g.label }))}
      sections={sections.map((s) => ({ id: s.id, name: s.name }))}
      schoolId={schoolIdParam}
      isSuperAdmin={isSuperAdmin}
      learners={rows}
      page={page}
      totalCount={totalCount}
      q={list.q}
      addLearner={
        !isSuperAdmin && defaultGradeId
          ? {
              gradeLevelId: defaultGradeId,
              grades: gradeOptions,
              sections,
            }
          : null
      }
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

  const list = parseLearnerListParams(sp);
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
            teachers: { some: { id: user.id } },
          },
      select: { id: true, type: true },
    });
    if (extra) assignedGrades = [extra, ...assignedGrades];
  }

  return (
    <AppShell
      title="Learners"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
    >
      {assignedGrades.length === 0 ? (
        <EmptyState
          title="No grades assigned"
          description="Ask your school head to assign you to a grade level."
        />
      ) : (
        <>
          <div className="mb-4">
            <Suspense
              fallback={
                <p className="text-sm text-muted-foreground">Loading…</p>
              }
            >
              <LearnersHeaderSubtitle
                assignedGradeIds={assignedGrades.map((g) => g.id)}
                teacherId={user.id}
                isSuperAdmin={isSuperAdmin}
                list={list}
                section={list.section}
                schoolIdParam={sp.schoolId}
              />
            </Suspense>
          </div>

          <Suspense fallback={<TableSectionSkeleton rows={8} columns={6} />}>
            <LearnersBody
              assignedGrades={assignedGrades}
              schoolId={schoolId}
              teacherId={user.id}
              isSuperAdmin={isSuperAdmin}
              schoolIdParam={sp.schoolId}
              list={list}
            />
          </Suspense>
        </>
      )}
    </AppShell>
  );
}
