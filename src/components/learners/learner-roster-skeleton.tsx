import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import { TableSectionSkeleton } from "@/components/loading";

/**
 * The roster's busy state, shared by the route's `loading.tsx` and the page's
 * own Suspense fallbacks.
 *
 * They must draw the same thing. `loading.tsx` is swapped out for the page as
 * soon as it streams, and the page then shows its own fallbacks while the
 * counts and rows resolve — so any difference between the two reads as one
 * skeleton morphing into a second before the content arrives. Sharing the
 * components is what keeps them from drifting apart again.
 */

/**
 * One roster stat card. Shorter than the dashboard's, because these four are
 * read-only — there is no action link on the last line to leave room for.
 */
function StatCardSkeleton() {
  return (
    <Surface as="section" className="p-5" data-slot="stat-card-skeleton">
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-xl" />
        <Skeleton className="h-4 w-28" />
      </div>
      <Skeleton className="mt-4 h-9 w-14" />
      <Skeleton className="mt-2 h-4 w-32" />
    </Surface>
  );
}

/** The four-card row, matching StatCardRow's grid exactly. */
export function LearnerStatCardsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <StatCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** The roster table panel — toolbar, header row, then rows. */
export function LearnerTableSkeleton() {
  return <TableSectionSkeleton rows={8} columns={7} />;
}

/**
 * The whole page as it first paints: title block, the four cards, the table.
 * Used by `loading.tsx`, so the geometry never shifts when the page takes over.
 */
export function LearnerRosterSkeleton() {
  return (
    <div className="w-full p-4 lg:p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading learners</span>

      <div
        className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between lg:mb-6"
        data-slot="roster-header-skeleton"
      >
        <div className="min-w-0">
          <Skeleton className="h-7 w-40 sm:h-8" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-44 rounded-lg" />
      </div>

      <LearnerStatCardsSkeleton />

      <div className="mt-4">
        <LearnerTableSkeleton />
      </div>
    </div>
  );
}
