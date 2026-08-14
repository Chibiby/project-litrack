import {
  MetricsGridSkeleton,
  ChartSectionSkeleton,
} from "@/components/loading";
import { Skeleton } from "@/components/ui/skeleton";
import { PostLoginLoadingBridge } from "@/components/post-login-loading-bridge";

/**
 * Root fallback for first paint / soft navigations outside role layouts.
 * Role routes use their own content-slot loaders under RoleShell.
 * This is the FIRST fallback streamed on the post-login hard navigation, so it
 * must go through PostLoginLoadingBridge or skeletons flash before the splash.
 */
export default function Loading() {
  return (
    <PostLoginLoadingBridge>
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-7xl space-y-6 p-4 lg:p-6">
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-3.5 w-80 max-w-full" />
          </div>

          <MetricsGridSkeleton variant="teacher" />
          <ChartSectionSkeleton columns={2} />
        </div>
      </div>
    </PostLoginLoadingBridge>
  );
}
