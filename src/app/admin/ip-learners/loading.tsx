import { TableSectionSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";

/** Content-slot skeleton: the banded hero, then both IP tables. RoleShell stays mounted. */
export default function AdminIpLearnersLoading() {
  return (
    <RouteLoadingOverlay>
      <SchoolHeadPageSkeleton hero>
        <div className="space-y-6">
          <TableSectionSkeleton rows={6} columns={5} />
          <TableSectionSkeleton rows={4} columns={3} />
        </div>
      </SchoolHeadPageSkeleton>
    </RouteLoadingOverlay>
  );
}