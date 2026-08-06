import {
  MetricsGridSkeleton,
  ChartSectionSkeleton,
  ListCardSkeleton,
  SkeletonThemeProvider,
} from "@/components/loading";

/**
 * Content-only route fallback. Sidebar + breadcrumbs stay mounted in
 * `teacher/layout.tsx` → RoleShell; this replaces only the page slot.
 */
export default function TeacherLoading() {
  return (
    <SkeletonThemeProvider>
      <div className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
        <MetricsGridSkeleton variant="teacher" />
        <ChartSectionSkeleton columns={1} />
        <ListCardSkeleton grid items={3} />
      </div>
    </SkeletonThemeProvider>
  );
}
