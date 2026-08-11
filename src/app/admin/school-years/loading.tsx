import { TableSectionSkeleton } from "@/components/loading";

/**
 * Content-slot skeleton for school years. Sidebar stays mounted in RoleShell;
 * matches the oversight table layout.
 */
export default function AdminSchoolYearsLoading() {
  return (
    <div className="w-full space-y-6 p-4 lg:p-8">
      <TableSectionSkeleton rows={8} columns={5} />
    </div>
  );
}
