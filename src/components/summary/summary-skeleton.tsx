import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import { TableSectionSkeleton } from "@/components/loading";

/** The toolbar's lower strip while the facet loads: coverage line, period controls, Export. */
export function SummaryPeriodBarSkeleton() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between" aria-hidden>
      <div className="min-w-0 space-y-2">
        <Skeleton className="h-5 w-56 max-w-full" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <Skeleton className="h-11 w-full sm:h-10 sm:w-28" />
    </div>
  );
}

/** Server-safe placeholder for a facet's results: two section cards. */
export function SummaryResultsSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <TableSectionSkeleton rows={5} columns={5} className="rounded-2xl" />
      <TableSectionSkeleton rows={5} columns={5} className="rounded-2xl" />
    </div>
  );
}

/**
 * Whole-page placeholder for a facet route: the banded hero, the facet tab
 * strip, the toolbar card, then results — the order the page paints in.
 */
export function SummaryFacetSkeleton() {
  return (
    <div className="w-full p-4 lg:p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading summary</span>
      <Skeleton className="mb-6 mt-2 h-60 w-full rounded-2xl lg:h-[19rem]" aria-hidden />
      <div className="space-y-4" aria-hidden>
        <div className="flex items-center gap-2 overflow-hidden border-b border-border/70 pb-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-24 shrink-0" />
          ))}
        </div>
        <Surface className="rounded-2xl">
          <div className="grid grid-cols-1 gap-3 p-3 sm:p-4 lg:grid-cols-3 lg:px-5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className="border-t border-border/60 p-3 sm:p-4 lg:px-5">
            <SummaryPeriodBarSkeleton />
          </div>
        </Surface>
        <SummaryResultsSkeleton />
      </div>
    </div>
  );
}
