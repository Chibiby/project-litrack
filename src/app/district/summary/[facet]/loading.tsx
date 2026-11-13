import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { PageSlide } from "@/components/ui/page-slide";
import { SummaryFacetSkeleton } from "@/components/summary/summary-skeleton";

export default function DistrictSummaryFacetLoading() {
  return (
    <RouteLoadingOverlay>
      <PageSlide side="child">
        <SummaryFacetSkeleton />
      </PageSlide>
    </RouteLoadingOverlay>
  );
}
