import {
  MetricsGridSkeleton,
  ChartSectionSkeleton,
} from "@/components/loading";

/**
 * Fuller content-slot skeleton for school-head soft navigations.
 * Sidebar + breadcrumbs stay mounted in `school-head/layout.tsx` → RoleShell;
 * this replaces only the page slot (do not wrap in another shell).
 */
export default function SchoolHeadLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
      <MetricsGridSkeleton variant="school-head" />
      <ChartSectionSkeleton columns={2} />
    </div>
  );
}
