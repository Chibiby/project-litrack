import { TableSectionSkeleton } from "@/components/loading";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";

/**
 * Content-slot skeleton for reports. Sidebar stays mounted in RoleShell;
 * avoids flashing the school-head dashboard skeleton on soft-nav.
 */
export default function SchoolHeadReportsLoading() {
  return (
    <RouteLoadingOverlay>
      <SchoolHeadPageSkeleton>
        <TableSectionSkeleton rows={12} columns={6} />
      </SchoolHeadPageSkeleton>
    </RouteLoadingOverlay>
  );
}
