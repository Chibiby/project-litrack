import { TableSectionSkeleton } from "@/components/loading";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";

/**
 * Content-slot skeleton for the IP learners page: two stacked table panels,
 * matching the grade/section breakdown and the by-group breakdown this page
 * renders once loaded.
 */
export default function SchoolHeadIpLearnersLoading() {
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
