import { TableSectionSkeleton } from "@/components/loading";

/**
 * Content-slot skeleton for the ARAL designation list. Sidebar stays mounted in
 * RoleShell; column count matches the five-column table.
 */
export default function SchoolHeadAralLoading() {
  return (
    <div className="w-full space-y-6 p-4 lg:p-6">
      <TableSectionSkeleton rows={8} columns={5} />
    </div>
  );
}