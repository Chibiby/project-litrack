import { TableSectionSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";

/** Content-slot only; RoleShell stays mounted like every other admin route. */
export default function AdminDatabaseLoading() {
  return (
    <RouteLoadingOverlay>
      <div className="w-full space-y-6 p-4 lg:p-6">
        <TableSectionSkeleton rows={6} columns={4} />
      </div>
    </RouteLoadingOverlay>
  );
}
