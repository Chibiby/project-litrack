import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
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

  // Sidebar grades + school name for real teachers come from teacher/layout
  // (RoleShell). Only super-admin impersonation needs a page-level school name
  // for the title; AppShell ignores chrome props when already inside RoleShell.
  const schoolName = isSuperAdmin
    ? await getSchoolName(targetSchoolId)
    : null;

  const sectionOpts = {
    schoolId: targetSchoolId,
    teacherId: user.id,
    isSuperAdmin,
  };

  return (
    <AppShell
      title={
        isSuperAdmin
          ? `Teacher View - ${schoolName || "Unknown"}`
          : `Hi, ${user.firstName}`
      }
      subtitle={
        isSuperAdmin
          ? "Super Admin View - All Grade Levels"
          : "Your assigned grade levels"
      }
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!params.schoolId}
      viewedSchoolName={schoolName ?? undefined}
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
