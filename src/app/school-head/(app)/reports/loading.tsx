import { TableSectionSkeleton } from "@/components/loading";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";

/**
 * Content-slot skeleton for reports. Sidebar stays mounted in RoleShell;
 * avoids flashing the school-head dashboard skeleton on soft-nav.
 */
export default function SchoolHeadReportsLoading() {
  return (
    <SchoolHeadPageSkeleton>
      <TableSectionSkeleton rows={12} columns={6} />
    </SchoolHeadPageSkeleton>
  );
}
