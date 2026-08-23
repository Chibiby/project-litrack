import { DualListCardSkeleton } from "@/components/loading";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";

/**
 * Content-slot skeleton for announcements. Two panels because the page pairs the
 * compose form with the published list; sidebar stays mounted in RoleShell.
 */
export default function Loading() {
  return (
    <RouteLoadingOverlay>
      <SchoolHeadPageSkeleton>
        <DualListCardSkeleton />
      </SchoolHeadPageSkeleton>
    </RouteLoadingOverlay>
  );
}
