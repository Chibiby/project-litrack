import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { SummarySlide } from "@/components/summary/summary-slide";
import { SummaryFacetSkeleton } from "@/components/summary/summary-skeleton";

export default function DistrictSummaryFacetLoading() {
  return (
    <RouteLoadingOverlay>
      <SummarySlide side="summary">
        <SummaryFacetSkeleton />
      </SummarySlide>
    </RouteLoadingOverlay>
  );
}
