import { ListCardSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";

export default function DistrictAnnouncementsLoading() {
  return (
    <RouteLoadingOverlay>
      <SchoolHeadPageSkeleton hero>
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
          <ListCardSkeleton items={4} className="rounded-2xl" />
          <ListCardSkeleton items={4} className="rounded-2xl" />
        </div>
      </SchoolHeadPageSkeleton>
    </RouteLoadingOverlay>
  );
}
