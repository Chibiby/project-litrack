import { TableSectionSkeleton } from "@/components/loading";

/**
 * Content-slot skeleton for transfer. Sidebar stays mounted in RoleShell;
 * matches the heavy form/table route without remounting a shell.
 */
export default function SchoolHeadTransferLoading() {
  return (
    <div className="w-full space-y-6 p-4 lg:p-8">
      <TableSectionSkeleton rows={6} columns={3} />
    </div>
  );
}
