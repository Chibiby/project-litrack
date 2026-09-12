import { TableSectionSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";

/**
 * Content-slot skeleton for the accounts console. Sidebar stays mounted in
 * RoleShell; matches the heavy table route without remounting a shell.
 */
export default function AdminAccountsLoading() {
  return (
    <RouteLoadingOverlay>
      <div className="w-full space-y-6 p-4 lg:p-6">
        <TableSectionSkeleton rows={10} columns={6} />
      </div>
    </RouteLoadingOverlay>
  );
}
