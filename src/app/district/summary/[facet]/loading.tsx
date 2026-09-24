import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { SummaryFacetSkeleton } from "@/components/summary/summary-skeleton";

export default function DistrictSummaryFacetLoading() {
  return (
    <RouteLoadingOverlay>
      <SummaryFacetSkeleton />
    </RouteLoadingOverlay>
  );
}
