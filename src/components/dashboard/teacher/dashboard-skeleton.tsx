import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";

/**
 * Mirrors the dashboard's real geometry — greeting, four stat cards, two
 * period panels, chart beside tasks — so the page does not reflow when the
 * data lands.
 */
function StatSkeleton() {
  return (
    <Surface as="section" className="p-5" data-slot="stat-card-skeleton">
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-xl" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="mt-4 h-9 w-16" />
      <Skeleton className="mt-2 h-3 w-28" />
      <Skeleton className="mt-4 h-4 w-32" />
    </Surface>
  );
}

function PanelSkeleton() {
  return (
    <Surface as="section" className="p-5">
      <Skeleton className="h-5 w-56" />
      <div className="mt-4 flex items-start justify-between gap-4">
        <div className="flex-1">
          <Skeleton className="h-10 w-20" />
          <Skeleton className="mt-2 h-3 w-36" />
        </div>
        <Skeleton className="h-12 w-24 rounded-lg" />
      </div>
      <Skeleton className="mt-4 h-2.5 w-full rounded-full" />
      <Skeleton className="mt-3 h-3 w-3/4" />
      <Skeleton className="mt-4 h-4 w-44" />
    </Surface>
  );
}

export function TeacherDashboardSkeleton() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your dashboard</span>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-72" />
          <Skeleton className="mt-2 h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-11 w-56 rounded-xl" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StatSkeleton key={i} />
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <PanelSkeleton />
        <PanelSkeleton />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[7fr_5fr] xl:grid-cols-[8fr_4fr]">
        <Surface as="section" className="p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="mt-2 h-3 w-40" />
          <Skeleton className="mt-5 h-[260px] w-full rounded-md" />
        </Surface>
        <div className="flex flex-col gap-4">
          <Surface as="section" className="p-5">
            <Skeleton className="h-5 w-40" />
            <div className="mt-4 space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          </Surface>
          <Surface as="section" className="p-5">
            <Skeleton className="h-5 w-32" />
            <div className="mt-4 grid grid-cols-3 gap-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          </Surface>
        </div>
      </div>
    </div>
  );
}
