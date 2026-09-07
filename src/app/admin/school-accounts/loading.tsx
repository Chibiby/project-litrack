import { TableSectionSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";

/** Matches the schools list: content-slot only, RoleShell stays mounted. */
export default function AdminSchoolAccountsLoading() {
  return (
    <RouteLoadingOverlay>
      <div className="w-full space-y-6 p-4 lg:p-6">
        <TableSectionSkeleton rows={8} columns={6} />
      </div>
    </RouteLoadingOverlay>
  );
}
