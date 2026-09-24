import { ListCardSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { Skeleton } from "@/components/ui/skeleton";

export default function DistrictSchoolLoading() {
  return (
    <RouteLoadingOverlay>
      <div className="w-full space-y-6 p-4 lg:p-6" aria-hidden>
        <div className="space-y-2">
          <Skeleton className="h-7 w-64 max-w-full" />
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <ListCardSkeleton items={4} className="lg:col-span-2" />
          <ListCardSkeleton items={3} />
        </div>
      </div>
    </RouteLoadingOverlay>
  );
}
