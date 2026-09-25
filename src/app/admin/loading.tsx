import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { PostLoginLoadingBridge } from "@/components/post-login-loading-bridge";
import { AdminDashboardSkeleton } from "@/components/dashboard/admin/dashboard-skeleton";

/**
 * Fuller content-slot skeleton for admin soft navigations.
 * Sidebar + header stay mounted in `admin/layout.tsx` → RoleShell;
 * this replaces only the page slot (do not wrap in another shell).
 * Post-login hard navigations get a cream cover via PostLoginLoadingBridge.
 */
export default function AdminLoading() {
  return (
    // Overlay INSIDE the bridge, and the nesting is load-bearing in one
    // direction only. The bridge renders its children solely in `skeleton`
    // mode; in `cover` and `boot` it paints the cream screen and drops them. So
    // nested this way the overlay's timer never starts during the post-login
    // cover, and no book can appear over the cream that hands off to
    // `PostLoginSplash`. Swap the two and the timer would run behind the cover
    // and fire a book into the middle of that handover.
    <PostLoginLoadingBridge>
      <RouteLoadingOverlay>
        <div className="w-full p-4 lg:p-6">
          <AdminDashboardSkeleton />
        </div>
      </RouteLoadingOverlay>
    </PostLoginLoadingBridge>
  );
}
