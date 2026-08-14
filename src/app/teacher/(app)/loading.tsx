import {
  MetricsGridSkeleton,
  ChartSectionSkeleton,
  ListCardSkeleton,
} from "@/components/loading";
import { PostLoginLoadingBridge } from "@/components/post-login-loading-bridge";

/**
 * Fuller content-slot skeleton for teacher soft navigations.
 * Sidebar + header stay mounted in `teacher/layout.tsx` → RoleShell;
 * this replaces only the page slot (do not wrap in another shell).
 * Post-login hard navigations get a cream cover via PostLoginLoadingBridge.
 */
export default function TeacherLoading() {
  return (
    <PostLoginLoadingBridge>
      <div className="w-full space-y-6 p-4 lg:p-6">
        <MetricsGridSkeleton variant="teacher" />
        <ChartSectionSkeleton columns={1} />
        <ListCardSkeleton grid items={3} />
      </div>
    </PostLoginLoadingBridge>
  );
}