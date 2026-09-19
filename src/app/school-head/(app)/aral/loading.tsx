import { TableSectionSkeleton } from "@/components/loading";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";

/**
 * Content-slot skeleton for the ARAL designation list. Sidebar stays mounted in
 * RoleShell; column count matches the five-column table. `hero` matches the
 * page's banded `SchoolHeadHero` first paint.
 */
export default function SchoolHeadAralLoading() {
  return (
    <RouteLoadingOverlay>
      <SchoolHeadPageSkeleton hero>
        <TableSectionSkeleton rows={8} columns={5} />
      </SchoolHeadPageSkeleton>
    </RouteLoadingOverlay>
  );
}
