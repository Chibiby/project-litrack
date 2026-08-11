import { TableSectionSkeleton } from "@/components/loading";

/**
 * Content-slot skeleton for audit. Sidebar stays mounted in RoleShell;
 * matches the table Suspense fallback on the page.
 */
export default function AdminAuditLoading() {
  return (
    <div className="w-full space-y-6 p-4 lg:p-8">
      <TableSectionSkeleton rows={10} columns={5} />
    </div>
  );
}
