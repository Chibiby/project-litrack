import { redirect } from "next/navigation";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

/** `/school-head/monitoring` has no page of its own: open the first Monitoring page. */
export default async function MonitoringIndex({ searchParams }: PageProps) {
  const { schoolId } = await searchParams;
  redirect(
    schoolId
      ? `${SCHOOL_HEAD_ROUTES.monitoringNonCompliance}?schoolId=${encodeURIComponent(schoolId)}`
      : SCHOOL_HEAD_ROUTES.monitoringNonCompliance
  );
}
