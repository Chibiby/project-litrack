import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";

/**
 * Mirrors the v2 dashboard's geometry — hero, four stat cards, two donut
 * panels beside a calendar and tasks rail, then chart and quick actions — so
 * the page does not reflow when the data lands.
 */
function StatSkeleton() {
  return (
    <Surface as="section" className="rounded-2xl p-4 sm:p-5" data-slot="stat-card-skeleton">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl sm:size-11" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="mt-3 h-9 w-14" />
      <Skeleton className="mt-2 h-3 w-28" />
      <Skeleton className="mt-4 hidden h-8 w-36 rounded-full lg:block" />
    </Surface>
  );
}

function PanelSkeleton() {
  return (
    <Surface as="section" className="rounded-2xl p-3 sm:p-5">
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-xl sm:size-11" />
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="mt-4 flex items-center gap-6">
        <Skeleton className="mx-auto size-32 rounded-full sm:size-36 lg:mx-0" />
        <div className="hidden flex-1 space-y-3 lg:block">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-full" />
          ))}
        </div>
      </div>
      <Skeleton className="mt-4 h-9 w-full rounded-xl lg:ml-auto lg:w-52 lg:rounded-full" />
    </Surface>
  );
}

export function TeacherDashboardSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading your dashboard</span>

      <Skeleton className="mt-2 h-60 w-full rounded-2xl lg:h-[19rem]" />

      <div className="relative z-10 grid gap-4 lg:-mt-16 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <StatSkeleton key={i} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <PanelSkeleton />
            <PanelSkeleton />
          </div>
        </div>
        <div className="flex flex-col gap-4 xl:-mt-4">
          <Skeleton className="hidden h-72 w-full rounded-2xl xl:block" />
          <Surface as="section" className="rounded-2xl p-5">
            <Skeleton className="h-5 w-40" />
            <div className="mt-4 space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          </Surface>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,32rem)]">
        <Skeleton className="order-2 h-64 w-full rounded-2xl xl:order-none" />
        <Surface as="section" className="order-1 rounded-2xl p-5 xl:order-none">
          <Skeleton className="h-5 w-32" />
          <div className="mt-4 grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-xl" />
            ))}
          </div>
        </Surface>
      </div>
    </div>
  );
}
