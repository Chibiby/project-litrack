import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";
import { PageSlide } from "@/components/ui/page-slide";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * One learner, while it loads. Its own skeleton (not the directory's) so the
 * slide in from the right is the learner's page, not the list's.
 */
export default function AdminLearnerLoading() {
  return (
    <RouteLoadingOverlay>
      <PageSlide side="child">
        <SchoolHeadPageSkeleton hero>
          <div className="grid gap-4 lg:grid-cols-2" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full rounded-lg" />
            ))}
          </div>
        </SchoolHeadPageSkeleton>
      </PageSlide>
    </RouteLoadingOverlay>
  );
}
