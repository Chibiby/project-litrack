import {
  MetricsGridSkeleton,
  ChartSectionSkeleton,
} from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";
import { PostLoginLoadingBridge } from "@/components/post-login-loading-bridge";

/**
 * Fuller content-slot skeleton for school-head soft navigations.
 * Sidebar + header stay mounted in `school-head/layout.tsx` → RoleShell;
 * this replaces only the page slot (do not wrap in another shell).
 * Post-login hard navigations get a cream cover via PostLoginLoadingBridge.
 */
export default function SchoolHeadLoading() {
  return (
    // Overlay INSIDE the bridge — same reasoning as `src/app/admin/loading.tsx`.
    // The bridge only renders children in `skeleton` mode, so nested this way the
    // overlay's timer cannot fire a book over the post-login cream cover.
    <PostLoginLoadingBridge>
      <RouteLoadingOverlay>
        <SchoolHeadPageSkeleton>
          <div className="space-y-6">
            <MetricsGridSkeleton variant="school-head" />
            <ChartSectionSkeleton columns={2} />
          </div>
        </SchoolHeadPageSkeleton>
      </RouteLoadingOverlay>
    </PostLoginLoadingBridge>
  );
}
