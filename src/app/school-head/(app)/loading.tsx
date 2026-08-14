import {
  MetricsGridSkeleton,
  ChartSectionSkeleton,
} from "@/components/loading";
import { PostLoginLoadingBridge } from "@/components/post-login-loading-bridge";

/**
 * Fuller content-slot skeleton for school-head soft navigations.
 * Sidebar + header stay mounted in `school-head/layout.tsx` → RoleShell;
 * this replaces only the page slot (do not wrap in another shell).
 * Post-login hard navigations get a cream cover via PostLoginLoadingBridge.
 */
export default function SchoolHeadLoading() {
  return (
    <PostLoginLoadingBridge>
      <div className="w-full space-y-6 p-4 lg:p-6">
        <MetricsGridSkeleton variant="school-head" />
        <ChartSectionSkeleton columns={2} />
      </div>
    </PostLoginLoadingBridge>
  );
}