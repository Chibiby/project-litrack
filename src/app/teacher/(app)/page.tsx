import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { AppShell } from "@/components/app-shell";
import { TeacherDashboardBody } from "@/components/dashboard/teacher/dashboard-body";

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
  const schoolName = isSuperAdmin ? await getSchoolName(targetSchoolId) : null;

  return (
    <AppShell
      // The dashboard opens with its own greeting and date, so the shell's
      // generic title block would only repeat it.
      hideTitle
      title={
        isSuperAdmin ? `Teacher View - ${schoolName || "Unknown"}` : `Hi, ${user.firstName}`
      }
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!params.schoolId}
      viewedSchoolName={schoolName ?? undefined}
    >
      {/* Rendered inline rather than behind a Suspense fallback: streaming a
          skeleton in here still shows a loading screen on a hard refresh, and
          the dashboard is one cached read, so waiting for it costs less than
          the flash did. */}
      <TeacherDashboardBody
        schoolId={targetSchoolId}
        teacherId={user.id}
        isSuperAdmin={isSuperAdmin}
        firstName={isSuperAdmin ? "Admin" : user.firstName}
        subtitle={
          isSuperAdmin
            ? `Super Admin view of ${schoolName || "this school"} — every grade level, not one teacher's care list.`
            : undefined
        }
      />
    </AppShell>
  );
}
