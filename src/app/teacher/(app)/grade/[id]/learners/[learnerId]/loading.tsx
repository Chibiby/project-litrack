import { TableSectionSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";

/** Content-slot only — RoleShell sidebar stays mounted during soft nav. */
export default function TeacherLearnerDetailLoading() {
  return (
    <RouteLoadingOverlay>
      <div className="w-full space-y-4 p-4 lg:p-6">
        <TableSectionSkeleton rows={6} columns={4} />
      </div>
    </RouteLoadingOverlay>
  );
}
