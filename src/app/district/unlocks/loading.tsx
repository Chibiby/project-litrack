import { ListCardSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";

export default function DistrictUnlocksLoading() {
  return (
    <RouteLoadingOverlay>
      <div className="w-full max-w-5xl space-y-6 p-4 lg:p-6">
        <ListCardSkeleton items={5} />
      </div>
    </RouteLoadingOverlay>
  );
}
