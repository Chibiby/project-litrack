import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getTeacherShellGrades } from "@/lib/dashboard/aggregates";
import { AppShell } from "@/components/app-shell";
import {
  TeacherMetricsSection,
  TeacherChartSection,
  TeacherGradeCardsSection,
} from "@/components/dashboard/teacher-dashboard-sections";
import {
  MetricsGridSkeleton,
  ChartSectionSkeleton,
  ListCardSkeleton,
} from "@/components/loading";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";

export const dynamic = "force-dynamic";

interface TeacherDashboardProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function TeacherDashboard({
  searchParams,
}: TeacherDashboardProps) {
  const params = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const targetSchoolId =
    isSuperAdmin && params.schoolId ? params.schoolId : user.schoolId;

  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");
  if (!targetSchoolId) redirect("/login");

  const school = await prisma.school.findUnique({
    where: { id: targetSchoolId },
    select: { name: true },
  });

  const shellGrades = await getTeacherShellGrades({
    schoolId: targetSchoolId,
    teacherId: user.id,
    isSuperAdmin,
  });

  const sidebarGrades = shellGrades.map((g) => ({
    id: g.id,
    label: GRADE_LEVEL_LABELS[g.type],
    hasAral: g.hasAral,
  }));

  const sectionOpts = {
    schoolId: targetSchoolId,
    teacherId: user.id,
    isSuperAdmin,
  };

  return (
    <AppShell
      title={
        isSuperAdmin
          ? `Teacher View - ${school?.name || "Unknown"}`
          : `Hi, ${user.firstName}`
      }
      subtitle={
        isSuperAdmin
          ? "Super Admin View - All Grade Levels"
          : "Your assigned grade levels"
      }
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={school?.name}
      grades={sidebarGrades}
      isSuperAdminView={isSuperAdmin && !!params.schoolId}
      viewedSchoolName={school?.name}
    >
      <Suspense
        fallback={
          <>
            <MetricsGridSkeleton variant="teacher" />
            <MetricsGridSkeleton variant="teacher-secondary" />
          </>
        }
      >
        <TeacherMetricsSection {...sectionOpts} />
      </Suspense>

      <Suspense fallback={<ChartSectionSkeleton columns={1} />}>
        <TeacherChartSection {...sectionOpts} />
      </Suspense>

      <Suspense fallback={<ListCardSkeleton grid items={3} />}>
        <TeacherGradeCardsSection {...sectionOpts} />
      </Suspense>
    </AppShell>
  );
}
