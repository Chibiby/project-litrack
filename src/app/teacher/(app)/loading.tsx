import { TableSectionSkeleton } from "@/components/loading";
import { PostLoginLoadingBridge } from "@/components/post-login-loading-bridge";

/**
 * Shell-level busy state for the whole `/teacher` tree.
 *
 * This boundary covers the *layout*, so it renders before RoleShell exists —
 * no sidebar, no header — and it appears for every teacher route, not just the
 * dashboard. It must therefore stay route-agnostic: a dashboard-shaped
 * skeleton here showed four stat cards and two chart panels on top of
 * `/teacher/learners`, which read as a broken page rather than a loading one.
 *
 * Nested routes that need a closer match ship their own `loading.tsx`, and the
 * dashboard's own skeleton lives in its page-level Suspense boundary.
 */
export default function TeacherLoading() {
  return (
    <PostLoginLoadingBridge>
      <div className="w-full space-y-4 p-4 lg:p-6">
        <TableSectionSkeleton rows={8} columns={5} />
      </div>
    </PostLoginLoadingBridge>
  );
}
