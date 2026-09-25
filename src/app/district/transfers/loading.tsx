import { TableSectionSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";

export default function DistrictTransfersLoading() {
  return (
    <RouteLoadingOverlay>
      <SchoolHeadPageSkeleton hero>
        <TableSectionSkeleton rows={6} columns={3} className="max-w-2xl rounded-2xl" />
      </SchoolHeadPageSkeleton>
    </RouteLoadingOverlay>
  );
}
