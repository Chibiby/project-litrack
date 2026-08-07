import {
  MetricsGridSkeleton,
  ChartSectionSkeleton,
  ListCardSkeleton,
} from "@/components/loading";

/**
 * Fuller content-slot skeleton for teacher soft navigations.
 * Sidebar + breadcrumbs stay mounted in `teacher/layout.tsx` → RoleShell;
 * this replaces only the page slot (do not wrap in another shell).
 */
export default function TeacherLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
      <MetricsGridSkeleton variant="teacher" />
      <ChartSectionSkeleton columns={1} />
      <ListCardSkeleton grid items={3} />
    </div>
  );
}
