import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import { TableSectionSkeleton } from "@/components/loading";

/** Server-safe placeholder for a facet's results: toolbar, notes, two tables. */
export function SummaryResultsSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Surface className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Skeleton className="h-5 w-56 max-w-full" />
          <Skeleton className="h-4 w-40 max-w-full" />
        </div>
        <Skeleton className="h-10 w-full sm:w-28" />
      </Surface>
      <TableSectionSkeleton rows={5} columns={5} />
      <TableSectionSkeleton rows={5} columns={5} />
    </div>
  );
}

/** Whole-page placeholder for a facet route: scope bar plus results. */
export function SummaryFacetSkeleton() {
  return (
    <div className="w-full space-y-4 p-4 lg:p-6" aria-hidden>
      <div className="space-y-2">
        <Skeleton className="h-7 w-64 max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Surface className="grid grid-cols-1 gap-3 p-4 lg:grid-cols-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </Surface>
      <SummaryResultsSkeleton />
    </div>
  );
}
