import { TableSectionSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";

/** Content-slot skeleton: the banded hero, then the stat row and the accounts table. RoleShell stays mounted. */
export default function AdminAccountsLoading() {
  return (
    <RouteLoadingOverlay>
      <SchoolHeadPageSkeleton hero>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-5">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="skeleton-shimmer h-24 rounded-2xl border" />
            ))}
          </div>
          <TableSectionSkeleton rows={10} columns={7} />
        </div>
      </SchoolHeadPageSkeleton>
    </RouteLoadingOverlay>
  );
}