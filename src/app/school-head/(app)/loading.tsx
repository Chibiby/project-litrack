import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { PostLoginLoadingBridge } from "@/components/post-login-loading-bridge";
import { SchoolHeadDashboardSkeleton } from "@/components/dashboard/school-head/dashboard-skeleton";

/**
 * The dashboard's own boundary. Draws the same skeleton the page's own
 * Suspense fallback draws (`docs/school-head-ui-rework.md` section 3.7), so
 * the handover is invisible rather than a second, differently-shaped
 * skeleton. Deliberately does not wrap in `SchoolHeadPageSkeleton` — that
 * would draw a title block above the hero block the dashboard no longer has.
 */
export default function SchoolHeadLoading() {
  return (
    <PostLoginLoadingBridge>
      <RouteLoadingOverlay>
        <div className="w-full p-4 lg:p-6">
          <SchoolHeadDashboardSkeleton />
        </div>
      </RouteLoadingOverlay>
    </PostLoginLoadingBridge>
  );
}
