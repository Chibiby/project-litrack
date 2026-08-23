import { TableSectionSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";

/**
 * Content-slot skeleton for the schools list. Sidebar stays mounted in
 * RoleShell; matches the heavy table route without remounting a shell.
 */
export default function AdminSchoolsLoading() {
  return (
    <RouteLoadingOverlay>
      <div className="w-full space-y-6 p-4 lg:p-6">
        <TableSectionSkeleton rows={8} columns={5} />
      </div>
    </RouteLoadingOverlay>
  );
}
