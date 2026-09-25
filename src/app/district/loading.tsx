import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { PostLoginLoadingBridge } from "@/components/post-login-loading-bridge";
import { DistrictOverviewSkeleton } from "@/components/district/overview-skeleton";

/**
 * Content-slot skeleton for the district overview. `/district` is where a
 * district admin lands after signing in, so it gets the same post-login cover
 * as the admin home (see `src/app/admin/loading.tsx` for the nesting order).
 */
export default function DistrictLoading() {
  return (
    <PostLoginLoadingBridge>
      <RouteLoadingOverlay>
        <div className="w-full p-4 lg:p-6">
          <DistrictOverviewSkeleton />
        </div>
      </RouteLoadingOverlay>
    </PostLoginLoadingBridge>
  );
}
