import { TableSectionSkeleton } from "@/components/loading";

/**
 * Content-slot skeleton for reports. Sidebar stays mounted in RoleShell;
 * avoids flashing the school-head dashboard skeleton on soft-nav.
 */
export default function SchoolHeadReportsLoading() {
  return (
    <div className="w-full space-y-6 p-4 lg:p-6">
      <TableSectionSkeleton rows={12} columns={6} />
    </div>
  );
}