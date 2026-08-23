import { TableSectionSkeleton } from "@/components/loading";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";

export default function Loading() {
  return (
    <RouteLoadingOverlay>
      <SchoolHeadPageSkeleton>
        <TableSectionSkeleton rows={6} columns={3} />
      </SchoolHeadPageSkeleton>
    </RouteLoadingOverlay>
  );
}
