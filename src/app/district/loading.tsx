import { ListCardSkeleton, MetricsGridSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { PostLoginLoadingBridge } from "@/components/post-login-loading-bridge";

/**
 * Content-slot skeleton for the district overview. `/district` is where a
 * district admin lands after signing in, so it gets the same post-login cover
 * as the admin home (see `src/app/admin/loading.tsx` for the nesting order).
 */
export default function DistrictLoading() {
  return (
    <PostLoginLoadingBridge>
      <RouteLoadingOverlay>
        <div className="w-full space-y-6 p-4 lg:p-6">
          <MetricsGridSkeleton variant="teacher" />
          <ListCardSkeleton items={6} grid />
        </div>
      </RouteLoadingOverlay>
    </PostLoginLoadingBridge>
  );
}
