import { DualListCardSkeleton } from "@/components/loading";

/**
 * Content-slot skeleton for teachers. Sidebar stays mounted in RoleShell;
 * matches the dual-list Suspense fallback on the page.
 */
export default function SchoolHeadTeachersLoading() {
  return (
    <div className="w-full space-y-6 p-4 lg:p-6">
      <DualListCardSkeleton />
    </div>
  );
}