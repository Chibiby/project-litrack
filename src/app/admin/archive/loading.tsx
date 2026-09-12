import { TableSectionSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";

/**
 * Content-slot skeleton for the archive tables. Sidebar stays mounted in
 * RoleShell; matches the two-table route without remounting a shell.
 */
export default function AdminArchiveLoading() {
  return (
    <RouteLoadingOverlay>
      <div className="w-full space-y-6 p-4 lg:p-6">
        <TableSectionSkeleton rows={6} columns={5} />
        <TableSectionSkeleton rows={6} columns={6} />
      </div>
    </RouteLoadingOverlay>
  );
}
