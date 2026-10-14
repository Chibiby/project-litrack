import { TableSectionSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";

export default function DistrictDeletedLearnersLoading() {
  return (
    <RouteLoadingOverlay>
      <SchoolHeadPageSkeleton hero>
        <TableSectionSkeleton rows={8} columns={6} className="rounded-2xl" />
      </SchoolHeadPageSkeleton>
    </RouteLoadingOverlay>
  );
}
