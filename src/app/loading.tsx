import {
  MetricsGridSkeleton,
  ChartSectionSkeleton,
} from "@/components/loading";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Root fallback for first paint / soft navigations outside role layouts.
 * Role routes use their own content-slot loaders under RoleShell.
 */
export default function Loading() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-3.5 w-80 max-w-full" />
        </div>

        <MetricsGridSkeleton variant="teacher" />
        <ChartSectionSkeleton columns={2} />
      </div>
    </div>
  );
}
