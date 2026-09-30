import { Skeleton } from "@/components/ui/skeleton";
import { Surface } from "@/components/ui/surface";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";

/**
 * Covers `/teacher/settings/profile` and `/teacher/settings/security`, which
 * share `TeacherSettingsShell`: a hero, then the Settings nav card beside the
 * page content. Without this the segment fell through to the shape-neutral
 * `(app)/loading.tsx`.
 */
export default function TeacherSettingsLoading() {
  return (
    <RouteLoadingOverlay>
      <div aria-hidden>
        <Skeleton className="h-40 w-full rounded-2xl lg:h-60" />
        <div className="mt-4 grid gap-4 lg:mt-6 lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start lg:gap-6">
          <Surface className="space-y-3 rounded-2xl p-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-48" />
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-xl" />
            ))}
          </Surface>
          <div className="flex min-w-0 flex-col gap-4 lg:gap-6">
            {Array.from({ length: 2 }).map((_, i) => (
              <Surface key={i} className="space-y-4 rounded-2xl p-5">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-2/3" />
              </Surface>
            ))}
          </div>
        </div>
      </div>
    </RouteLoadingOverlay>
  );
}
