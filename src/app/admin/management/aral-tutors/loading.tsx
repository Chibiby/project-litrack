import { MetricsGridSkeleton, TableSectionSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";

/** Content-slot skeleton: the banded hero, the three figure cards, then the filtered six-column tutor table. RoleShell stays mounted. */
export default function AdminAralTutorsLoading() {
  return (
    <RouteLoadingOverlay>
      <SchoolHeadPageSkeleton hero>
        <div className="space-y-6">
          <MetricsGridSkeleton className="mb-0" count={3} />
          <TableSectionSkeleton rows={8} columns={6} />
        </div>
      </SchoolHeadPageSkeleton>
    </RouteLoadingOverlay>
  );
}
