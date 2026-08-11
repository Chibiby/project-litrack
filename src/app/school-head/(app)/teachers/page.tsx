import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
import {
  parseTeachersListParams,
  teachersTotalPages,
} from "@/lib/teachers/pagination";
import { AppShell } from "@/components/app-shell";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import {
  TeachersPendingTable,
  type PendingTeacherRow,
  type SectionOption,
} from "@/components/teachers-pending-table";
import {
  TeachersActiveTable,
  TeachersInactiveTable,
  TeachersDeclinedTable,
  type ActiveTeacherRow,
  type DeclinedTeacherRow,
} from "@/components/teachers-active-table";
import { DualListCardSkeleton } from "@/components/loading";
import { EmptyState } from "@/components/dashboard/empty-state";
import { GraduationCap } from "lucide-react";

export const dynamic = "force-dynamic";

interface TeachersPageProps {
  searchParams: Promise<{ schoolId?: string; page?: string; q?: string }>;
}

const managedTeacherSelect = {
  id: true,
  fullName: true,
  email: true,
  profileCompleted: true,
  approvedAt: true,
  taughtGrades: { select: { type: true } },
  taughtSections: {
    where: { section: { deletedAt: null } },
    select: {
      section: {
        select: {
          id: true,
          name: true,
          gradeLevel: { select: { type: true } },
        },
      },
    },
  },
  _count: {
    select: {
      managedLearners: { where: { deletedAt: null } },
    },
  },
} satisfies Prisma.UserSelect;

type ManagedTeacher = Prisma.UserGetPayload<{
  select: typeof managedTeacherSelect;
}>;

function toManagedRow(t: ManagedTeacher): ActiveTeacherRow {
  const activeSections = t.taughtSections.map((ts) => ts.section);
  return {
    id: t.id,
    fullName: t.fullName,
    email: t.email,
    grades: t.taughtGrades.map((g) => GRADE_LEVEL_LABELS[g.type]),
    sections: activeSections.map(
      (s) => `${GRADE_LEVEL_LABELS[s.gradeLevel.type]}-${s.name}`
    ),
    sectionIds: activeSections.map((s) => s.id),
    profileCompleted: t.profileCompleted,
    approvedAt: t.approvedAt?.toISOString() ?? null,
    learnerCount: t._count.managedLearners,
  };
}

async function TeachersBody({
  schoolId,
  isSuperAdminView,
  list,
}: {
  schoolId: string;
  isSuperAdminView: boolean;
  list: ReturnType<typeof parseTeachersListParams>;
}) {
  const teacherBase: Prisma.UserWhereInput = {
    schoolId,
    role: "TEACHER",
    deletedAt: null,
  };

  const activeWhere: Prisma.UserWhereInput = {
    ...teacherBase,
    approvalStatus: "APPROVED",
    isActive: true,
    ...(list.q
      ? {
          OR: [
            { fullName: { contains: list.q, mode: "insensitive" } },
            { email: { contains: list.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [
    grades,
    sectionRows,
    pendingTeachers,
    activeTeachers,
    activeCount,
    inactiveTeachers,
    declinedTeachers,
  ] = await Promise.all([
    prisma.gradeLevel.findMany({
      where: { schoolId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    }),
    prisma.section.findMany({
      where: { schoolId, deletedAt: null },
      select: {
        id: true,
        name: true,
        gradeLevelId: true,
        gradeLevel: { select: { type: true } },
      },
      orderBy: [{ gradeLevelId: "asc" }, { name: "asc" }],
    }),
    prisma.user.findMany({
      where: { ...teacherBase, approvalStatus: "PENDING" },
      select: {
        id: true,
        fullName: true,
        email: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findMany({
      where: activeWhere,
      select: managedTeacherSelect,
      orderBy: { createdAt: "desc" },
      skip: list.skip,
      take: list.take,
    }),
    prisma.user.count({ where: activeWhere }),
    prisma.user.findMany({
      where: {
        ...teacherBase,
        approvalStatus: "APPROVED",
        isActive: false,
      },
      select: managedTeacherSelect,
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.findMany({
      where: { ...teacherBase, approvalStatus: "REJECTED" },
      select: {
        id: true,
        fullName: true,
        email: true,
        rejectedAt: true,
      },
      orderBy: { rejectedAt: "desc" },
    }),
  ]);

  const sectionOptions: SectionOption[] = sectionRows.map((s) => ({
    id: s.id,
    name: s.name,
    gradeLevelId: s.gradeLevelId,
    gradeLabel: GRADE_LEVEL_LABELS[s.gradeLevel.type],
  }));

  const pendingRows: PendingTeacherRow[] = pendingTeachers.map((t) => ({
    id: t.id,
    fullName: t.fullName,
    email: t.email,
    requestedAt: t.createdAt.toISOString(),
  }));

  const activeRows: ActiveTeacherRow[] = activeTeachers.map(toManagedRow);
  const inactiveRows: ActiveTeacherRow[] = inactiveTeachers.map(toManagedRow);

  const declinedRows: DeclinedTeacherRow[] = declinedTeachers.map((t) => ({
    id: t.id,
    fullName: t.fullName,
    email: t.email,
    rejectedAt: t.rejectedAt?.toISOString() ?? null,
  }));

  const basePath = "/school-head/teachers";
  const listSearchParams: Record<string, string | undefined> = {
    schoolId: isSuperAdminView ? schoolId : undefined,
    q: list.q || undefined,
  };

  if (grades.length === 0) {
    return (
      <EmptyState
        title="No grade levels yet"
        description="Create at least one grade level before approving teachers."
        actionHref={
          isSuperAdminView
            ? `/school-head/grade-levels?schoolId=${schoolId}`
            : "/school-head/grade-levels"
        }
        actionLabel="Go to grade levels"
        icon={GraduationCap}
      />
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Teachers self-register from the login page (email verification code once, then password).
        After you approve them with one or more sections, they sign in with email and password only.
      </p>

      {sectionOptions.length === 0 ? (
        <EmptyState
          title="No sections yet"
          description="Add sections under each grade before assigning teachers."
          actionHref={
            isSuperAdminView
              ? `/school-head/grade-levels?schoolId=${schoolId}`
              : "/school-head/grade-levels"
          }
          actionLabel="Go to grade levels"
          icon={GraduationCap}
        />
      ) : null}

      <TeachersPendingTable
        rows={pendingRows}
        sections={sectionOptions}
        readOnly={isSuperAdminView}
      />

      <TeachersActiveTable
        rows={activeRows}
        sections={sectionOptions}
        readOnly={isSuperAdminView}
        list={{
          page: list.page,
          totalPages: teachersTotalPages(activeCount, list.pageSize),
          totalCount: activeCount,
          q: list.q,
          basePath,
          searchParams: listSearchParams,
        }}
      />

      <TeachersInactiveTable
        rows={inactiveRows}
        sections={sectionOptions}
        readOnly={isSuperAdminView}
      />

      <TeachersDeclinedTable rows={declinedRows} readOnly={isSuperAdminView} />
    </div>
  );
}

export default async function TeachersPage({ searchParams }: TeachersPageProps) {
  const params = await searchParams;
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.profileCompleted && user.role !== "SUPER_ADMIN") redirect("/school-head/profiling");

  const { schoolId, isSuperAdminView } = await resolveSchoolContext(
    user,
    params.schoolId,
    "/school-head/teachers"
  );

  const list = parseTeachersListParams(params);
  const schoolName = await getSchoolName(schoolId);

  return (
    <AppShell
      title={isSuperAdminView ? `Teachers - ${schoolName || "Unknown"}` : "Teachers"}
      subtitle={
        isSuperAdminView
          ? "Super Admin View"
          : "Review registration requests and manage teachers"
      }
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={schoolName ?? undefined}
      isSuperAdminView={isSuperAdminView}
      viewedSchoolName={schoolName ?? undefined}
    >
      <Suspense fallback={<DualListCardSkeleton />}>
        <TeachersBody
          schoolId={schoolId}
          isSuperAdminView={isSuperAdminView}
          list={list}
        />
      </Suspense>
    </AppShell>
  );
}
