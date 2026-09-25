import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";

/** One headline tile while its figure streams; the shape of `StatCard`. */
export function DistrictStatSkeleton() {
  return (
    <Surface as="section" className="rounded-2xl p-4 sm:p-5" data-slot="stat-card-skeleton" aria-hidden>
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl sm:size-11" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="mt-3 h-9 w-16" />
      <Skeleton className="mt-2 h-3 w-28 max-w-full" />
      <Skeleton className="mt-4 hidden h-8 w-36 rounded-full lg:block" />
    </Surface>
  );
}

/** The attention rail while tickets and compliance load. */
export function DistrictAttentionSkeleton() {
  return (
    <Surface as="section" className="rounded-2xl p-4 sm:p-5" aria-hidden>
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl" />
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="mt-4 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </Surface>
  );
}

function DistrictsPanelSkeleton() {
  return (
    <Surface as="section" className="rounded-2xl p-4 sm:p-5" aria-hidden>
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl" />
        <Skeleton className="h-5 w-36" />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-xl" />
        ))}
      </div>
    </Surface>
  );
}

/**
 * The district overview's first paint, block for block: greeting hero, four
 * headline tiles, the districts panel beside the attention rail, then the
 * summaries grid. The route's `loading.tsx` draws this, so the handover to the
 * page's own per-tile fallbacks does not move anything.
 */
export function DistrictOverviewSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading your overview</span>

      <Skeleton className="mb-2 mt-2 h-60 w-full rounded-2xl lg:h-[19rem]" aria-hidden />

      <div className="relative z-10 grid grid-cols-1 gap-4 lg:-mt-16 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 2xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <DistrictStatSkeleton key={i} />
            ))}
          </div>
          <DistrictsPanelSkeleton />
        </div>
        <div className="flex min-w-0 flex-col gap-4 xl:-mt-4">
          <Skeleton className="hidden h-72 w-full rounded-2xl xl:block" aria-hidden />
          <DistrictAttentionSkeleton />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
