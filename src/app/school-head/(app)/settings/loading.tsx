import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";

/**
 * Covers `/settings`, `/settings/profile` and `/settings/security` — none of
 * the three has its own boundary. `settings/layout.tsx` renders only
 * `children` (`AppShell` plus `SchoolHeadSettingsShell` are drawn by each
 * page, same as every other School Head route), so without this the segment
 * fell through to the dashboard-shaped `(app)/loading.tsx` above it. Two
 * cards rather than one: `/settings/security` splits into a password card and
 * an email card side by side, and `/settings/profile` is close enough as a
 * single stacked card that duplicating this per-page would not earn its keep.
 */
export default function SchoolHeadSettingsLoading() {
  return (
    <RouteLoadingOverlay>
      <SchoolHeadPageSkeleton hero>
        <div className="grid gap-4 lg:gap-6 xl:grid-cols-2" aria-hidden>
          {Array.from({ length: 2 }).map((_, i) => (
            <Surface key={i} className="space-y-4 rounded-2xl p-5">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-2/3" />
            </Surface>
          ))}
        </div>
      </SchoolHeadPageSkeleton>
    </RouteLoadingOverlay>
  );
}
