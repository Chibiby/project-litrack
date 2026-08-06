import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  AdminMetricsSection,
  AdminChartsSection,
  AdminRecentSchoolsSection,
} from "@/components/dashboard/admin-dashboard-sections";
import {
  MetricsGridSkeleton,
  ChartSectionSkeleton,
  ListCardSkeleton,
} from "@/components/loading";
import { Plus, ScrollText, CalendarRange } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const user = await requireUser("SUPER_ADMIN");

  return (
    <AppShell
      title="Admin Dashboard"
      subtitle="System-wide overview"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <div className="mb-6 flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href="/admin/schools/new">
            <Plus className="mr-1 h-4 w-4" /> New school
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/admin/audit">
            <ScrollText className="mr-1 h-4 w-4" /> Audit log
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/admin/school-years">
            <CalendarRange className="mr-1 h-4 w-4" /> School years
          </Link>
        </Button>
      </div>

      <Suspense fallback={<MetricsGridSkeleton variant="admin" />}>
        <AdminMetricsSection />
      </Suspense>

      <Suspense fallback={<ChartSectionSkeleton columns={2} />}>
        <AdminChartsSection />
      </Suspense>

      <Suspense fallback={<ListCardSkeleton items={5} className="mb-6" />}>
        <AdminRecentSchoolsSection />
      </Suspense>
    </AppShell>
  );
}
