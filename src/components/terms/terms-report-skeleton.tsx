import { Skeleton } from "@/components/ui/skeleton";

/**
 * The End of Terms busy states, shared by the routes' `loading.tsx` and the
 * page's own Suspense fallback so one never morphs into a differently-shaped
 * second before the content arrives.
 */

/** Under the banner: the four cards, the auto-lock notice, the table panel. */
export function TermsReportBodySkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading end of terms reports">
      <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl lg:h-36" />
        ))}
      </div>
      <Skeleton className="mt-4 h-20 rounded-2xl" />
      <Skeleton className="mt-4 h-96 rounded-2xl" />
    </div>
  );
}

/** The whole page as it first paints: gutter, banner, then the body. */
export function TermsReportRouteSkeleton() {
  return (
    <div className="w-full p-4 lg:p-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading end of terms reports</span>
      {/* The v2 banner: same box as the page's PageHero (15rem, lg 17rem). */}
      <Skeleton className="mt-2 h-[15rem] rounded-2xl lg:h-[17rem]" />
      <TermsReportBodySkeleton />
    </div>
  );
}
