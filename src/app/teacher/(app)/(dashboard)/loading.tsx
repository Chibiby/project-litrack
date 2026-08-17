import { TeacherDashboardSkeleton } from "@/components/dashboard/teacher/dashboard-skeleton";

/**
 * The dashboard's own boundary.
 *
 * `/teacher` lives in the `(dashboard)` route group purely so this file can
 * exist: a `loading.tsx` beside the page in `(app)` would have wrapped the
 * roster, ARAL and reports too, which is why the shared one there has to stay
 * shape-neutral. Route groups do not appear in the URL, so `/teacher` is
 * unchanged.
 *
 * It draws the same skeleton the page's own Suspense fallback draws, so the
 * handover is invisible rather than a second, differently-shaped skeleton.
 */
export default function TeacherDashboardLoading() {
  return (
    <div className="w-full p-4 lg:p-6">
      <TeacherDashboardSkeleton />
    </div>
  );
}
