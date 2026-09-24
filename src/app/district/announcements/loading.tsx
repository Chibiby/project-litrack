import { ListCardSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";

export default function DistrictAnnouncementsLoading() {
  return (
    <RouteLoadingOverlay>
      <div className="grid w-full grid-cols-1 gap-6 p-4 lg:grid-cols-2 lg:p-6">
        <ListCardSkeleton items={4} />
        <ListCardSkeleton items={4} />
      </div>
    </RouteLoadingOverlay>
  );
}
