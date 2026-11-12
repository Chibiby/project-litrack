import { ChartSectionSkeleton, MetricsGridSkeleton, TableSectionSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";

/** Content-slot skeleton: the hero, the six cards, the breakdowns, then the tables. */
export default function AdminIpLearnersLoading() {
  return (
    <RouteLoadingOverlay>
      <SchoolHeadPageSkeleton hero>
        <div className="space-y-6">
          <MetricsGridSkeleton className="mb-0" count={6} />
          <ChartSectionSkeleton columns={2} />
          <TableSectionSkeleton rows={6} columns={5} />
        </div>
      </SchoolHeadPageSkeleton>
    </RouteLoadingOverlay>
  );
}
