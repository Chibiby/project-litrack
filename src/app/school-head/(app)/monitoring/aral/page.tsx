import { TeacherTasksMonitoringPage } from "@/components/school-head/monitoring/teacher-tasks-page";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function MonitoringAralPage({ searchParams }: PageProps) {
  const { schoolId } = await searchParams;
  return <TeacherTasksMonitoringPage scope="ARAL" schoolIdParam={schoolId} />;
}
