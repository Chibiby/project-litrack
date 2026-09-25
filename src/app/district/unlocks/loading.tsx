import { ListCardSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";

export default function DistrictUnlocksLoading() {
  return (
    <RouteLoadingOverlay>
      <SchoolHeadPageSkeleton hero>
        <ListCardSkeleton items={5} className="max-w-5xl rounded-2xl" />
      </SchoolHeadPageSkeleton>
    </RouteLoadingOverlay>
  );
}
