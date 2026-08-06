import {
  MetricsGridSkeleton,
  ChartSectionSkeleton,
  SkeletonThemeProvider,
} from "@/components/loading";

/**
 * Content-only route fallback. Sidebar + breadcrumbs stay mounted in
 * `school-head/layout.tsx` → RoleShell; this replaces only the page slot.
 */
export default function SchoolHeadLoading() {
  return (
    <SkeletonThemeProvider>
      <div className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
        <MetricsGridSkeleton variant="school-head" />
        <ChartSectionSkeleton columns={2} />
      </div>
    </SkeletonThemeProvider>
  );
}
