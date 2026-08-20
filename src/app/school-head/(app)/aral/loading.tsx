import { TableSectionSkeleton } from "@/components/loading";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";

/**
 * Content-slot skeleton for the ARAL designation list. Sidebar stays mounted in
 * RoleShell; column count matches the five-column table.
 */
export default function SchoolHeadAralLoading() {
  return (
    <SchoolHeadPageSkeleton>
      <TableSectionSkeleton rows={8} columns={5} />
    </SchoolHeadPageSkeleton>
  );
}
