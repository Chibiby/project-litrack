import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import {
  TeachersPendingTable,
  type PendingTeacherRow,
} from "@/components/teachers-pending-table";
import {
  TeachersActiveTable,
  TeachersDeclinedTable,
  type ActiveTeacherRow,
  type DeclinedTeacherRow,
} from "@/components/teachers-active-table";
import { DualListCardSkeleton } from "@/components/loading";

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
  const [grades, teachers] = await Promise.all([
    prisma.gradeLevel.findMany({
      where: { schoolId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({
      where: { schoolId, role: "TEACHER", deletedAt: null },
      include: { taughtGrades: { select: { type: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const gradeOptions = grades.map((g) => ({
    id: g.id,
    label: GRADE_LEVEL_LABELS[g.type],
  }));

  const pendingRows: PendingTeacherRow[] = teachers
    .filter((t) => t.approvalStatus === "PENDING")
    .map((t) => ({
      id: t.id,
      fullName: t.fullName,
      email: t.email,
      requestedAt: t.createdAt.toISOString(),
    }));

  const activeRows: ActiveTeacherRow[] = teachers
    .filter((t) => t.isActive)
    .map((t) => ({
      id: t.id,
      fullName: t.fullName,
      email: t.email,
      grades: t.taughtGrades.map((g) => GRADE_LEVEL_LABELS[g.type]),
      profileCompleted: t.profileCompleted,
      approvedAt: t.approvedAt?.toISOString() ?? null,
    }));

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
      <Card>
        <CardContent className="p-6 text-center text-muted-foreground">
          Create at least one grade level first.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Teachers register from the login page with email or Google, then appear here for approval.
      </p>

      <TeachersPendingTable
        rows={pendingRows}
        grades={gradeOptions}
        readOnly={isSuperAdminView}
      />

      <TeachersActiveTable rows={activeRows} />

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
