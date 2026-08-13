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
import {
  TeachersPendingTable,
  type PendingTeacherRow,
} from "@/components/teachers-pending-table";
import {
  TeachersActiveTable,
  TeachersInactiveTable,
  TeachersDeclinedTable,
  type ActiveTeacherRow,
  type DeclinedTeacherRow,
} from "@/components/teachers-active-table";
import { DualListCardSkeleton } from "@/components/loading";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";

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
  advisorySection: {
    select: { name: true, gradeLevel: { select: { type: true } } },
  },
  _count: {
    select: {
      managedLearners: { where: { deletedAt: null } },
      aralLearners: { where: { deletedAt: null } },
    },
  },
} satisfies Prisma.UserSelect;

type ManagedTeacher = Prisma.UserGetPayload<{
  select: typeof managedTeacherSelect;
}>;

function toManagedRow(t: ManagedTeacher): ActiveTeacherRow {
  return {
    id: t.id,
    fullName: t.fullName,
    email: t.email,
    profileCompleted: t.profileCompleted,
    approvedAt: t.approvedAt?.toISOString() ?? null,
    learnerCount: t._count.managedLearners,
    aralLearnerCount: t._count.aralLearners,
    // Read-only: teachers set this themselves during profiling.
    assignment: t.advisorySection
      ? {
          gradeName:
            GRADE_LEVEL_LABELS[t.advisorySection.gradeLevel.type] ??
            t.advisorySection.gradeLevel.type,
          sectionName: t.advisorySection.name,
        }
      : null,
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
    pendingTeachers,
    activeTeachers,
    activeCount,
    inactiveTeachers,
    declinedTeachers,
    gradeLevelCount,
    freeSectionCount,
  ] = await Promise.all([
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
    // Profiling capacity: teachers self-assign, so a school with no grade levels
    // or no adviser-free section leaves them unable to finish onboarding.
    prisma.gradeLevel.count({ where: { schoolId, deletedAt: null } }),
    prisma.section.count({
      where: { schoolId, deletedAt: null, adviser: null },
    }),
  ]);

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

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Teachers self-register from the login page (email verification code once, then password).
        After you approve them, they sign in with email and password only. Grade and
        section assignment happens when the teacher completes their own profile.
      </p>

      {gradeLevelCount === 0 || freeSectionCount === 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {gradeLevelCount === 0 ? (
            <>
              This school has no grade levels yet, so teachers cannot finish
              profiling. Add grade levels and sections in{" "}
              <strong>Grade Levels</strong> first.
            </>
          ) : (
            <>
              Every section already has an adviser. New teachers will have
              nothing to choose in profiling until you add more sections in{" "}
              <strong>Grade Levels</strong>.
            </>
          )}
        </div>
      ) : null}

      <TeachersPendingTable rows={pendingRows} readOnly={isSuperAdminView} />

      <TeachersActiveTable
        rows={activeRows}
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

      <TeachersInactiveTable rows={inactiveRows} readOnly={isSuperAdminView} />

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
