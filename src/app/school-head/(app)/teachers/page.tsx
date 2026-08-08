import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
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
  searchParams: Promise<{ schoolId?: string }>;
}

async function TeachersBody({
  schoolId,
  isSuperAdminView,
}: {
  schoolId: string;
  isSuperAdminView: boolean;
}) {
  const [grades, sectionRows, teachers] = await Promise.all([
    prisma.gradeLevel.findMany({
      where: { schoolId, deletedAt: null },
      orderBy: { createdAt: "asc" },
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
      where: { schoolId, role: "TEACHER", deletedAt: null },
      include: {
        taughtGrades: { select: { type: true } },
        taughtSections: {
          include: {
            section: {
              select: {
                id: true,
                name: true,
                deletedAt: true,
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
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const sectionOptions: SectionOption[] = sectionRows.map((s) => ({
    id: s.id,
    name: s.name,
    gradeLevelId: s.gradeLevelId,
    gradeLabel: GRADE_LEVEL_LABELS[s.gradeLevel.type],
  }));

  const toManagedRow = (t: (typeof teachers)[number]): ActiveTeacherRow => {
    const activeSections = t.taughtSections
      .map((ts) => ts.section)
      .filter((s) => s.deletedAt == null);
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
  };

  const pendingRows: PendingTeacherRow[] = teachers
    .filter((t) => t.approvalStatus === "PENDING")
    .map((t) => ({
      id: t.id,
      fullName: t.fullName,
      email: t.email,
      requestedAt: t.createdAt.toISOString(),
    }));

  const activeRows: ActiveTeacherRow[] = teachers
    .filter((t) => t.approvalStatus === "APPROVED" && t.isActive)
    .map(toManagedRow);

  const inactiveRows: ActiveTeacherRow[] = teachers
    .filter((t) => t.approvalStatus === "APPROVED" && !t.isActive)
    .map(toManagedRow);

  const declinedRows: DeclinedTeacherRow[] = teachers
    .filter((t) => t.approvalStatus === "REJECTED")
    .map((t) => ({
      id: t.id,
      fullName: t.fullName,
      email: t.email,
      rejectedAt: t.rejectedAt?.toISOString() ?? null,
    }));

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
        <TeachersBody schoolId={schoolId} isSuperAdminView={isSuperAdminView} />
      </Suspense>
    </AppShell>
  );
}
