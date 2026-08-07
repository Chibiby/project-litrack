import { TableSectionSkeleton } from "@/components/loading";

/**
 * Content-slot skeleton for the schools list. Sidebar stays mounted in
 * RoleShell; matches the heavy table route without remounting a shell.
 */
export default function AdminSchoolsLoading() {
  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
      <TableSectionSkeleton rows={8} columns={5} />
    </div>
  );
}
