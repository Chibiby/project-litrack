import { TableSectionSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";
import { PageSlide } from "@/components/ui/page-slide";

/** Content-slot skeleton: the banded hero, then the schools table. RoleShell stays mounted. */
export default function AdminSchoolsLoading() {
  return (
    <RouteLoadingOverlay>
      <PageSlide side="parent">
        <SchoolHeadPageSkeleton hero>
          <div className="space-y-6">
            <TableSectionSkeleton rows={8} columns={5} />
          </div>
        </SchoolHeadPageSkeleton>
      </PageSlide>
    </RouteLoadingOverlay>
  );
}