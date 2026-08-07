import {
  MetricsGridSkeleton,
  ChartSectionSkeleton,
} from "@/components/loading";

/**
 * Fuller content-slot skeleton for admin soft navigations.
 * Sidebar + breadcrumbs stay mounted in `admin/layout.tsx` → RoleShell;
 * this replaces only the page slot (do not wrap in another shell).
 */
export default function AdminLoading() {
  return (
    <div className="w-full space-y-6 p-4 lg:p-8">
      <MetricsGridSkeleton variant="admin" />
      <ChartSectionSkeleton columns={2} />
    </div>
  );
}
