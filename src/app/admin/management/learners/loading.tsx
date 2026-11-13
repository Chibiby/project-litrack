import { TableSectionSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";
import { PageSlide } from "@/components/ui/page-slide";

/** Content-slot skeleton: the banded hero, then the learner tables. RoleShell stays mounted. */
export default function AdminLearnersLoading() {
  return (
    <RouteLoadingOverlay>
      <PageSlide side="parent">
        <SchoolHeadPageSkeleton hero>
          <div className="space-y-6">
            <TableSectionSkeleton rows={6} columns={5} />
            <TableSectionSkeleton rows={4} columns={3} />
          </div>
        </SchoolHeadPageSkeleton>
      </PageSlide>
    </RouteLoadingOverlay>
  );
}
