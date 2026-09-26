import { ListCardSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { Skeleton } from "@/components/ui/skeleton";

export default function DistrictSchoolLoading() {
  return (
    <RouteLoadingOverlay>
      <div className="w-full space-y-6 p-4 lg:p-6" aria-hidden>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <Skeleton className="h-7 w-64 max-w-full" />
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-11 w-full sm:w-32 lg:h-9" />
        </div>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <ListCardSkeleton items={4} className="rounded-2xl" />
          <div className="grid grid-cols-1 content-start gap-6 md:grid-cols-2 xl:grid-cols-1">
            <ListCardSkeleton items={1} className="rounded-2xl" />
            <ListCardSkeleton items={1} className="rounded-2xl" />
          </div>
        </div>
      </div>
    </RouteLoadingOverlay>
  );
}
