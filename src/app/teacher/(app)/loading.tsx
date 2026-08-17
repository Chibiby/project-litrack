import { TeacherDashboardSkeleton } from "@/components/dashboard/teacher/dashboard-skeleton";
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
      <div className="w-full p-4 lg:p-6">
        <TeacherDashboardSkeleton />
      </div>
    </PostLoginLoadingBridge>
  );
}
