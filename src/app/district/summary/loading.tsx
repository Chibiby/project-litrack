import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { SummarySlide } from "@/components/summary/summary-slide";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function DistrictSummaryLoading() {
  return (
    <RouteLoadingOverlay>
      <SummarySlide side="list">
        <SchoolHeadPageSkeleton hero>
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3"
            aria-hidden
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        </SchoolHeadPageSkeleton>
      </SummarySlide>
    </RouteLoadingOverlay>
  );
}
