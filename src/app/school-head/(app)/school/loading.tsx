import { ListCardSkeleton } from "@/components/loading";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";

/**
 * Covers the three School pages: Overview, School Year, and Grade and Section.
 *
 * One boundary at the workspace root rather than one per page: the closest
 * `loading.tsx` above a segment is the one Next uses. Grade and Section is the
 * heaviest page, so the grid skeleton below is sized for it. No tab bar: the
 * three are separate sidebar entries.
 */
export default function SchoolWorkspaceLoading() {
  return (
    <RouteLoadingOverlay>
      <SchoolHeadPageSkeleton hero>
        <ListCardSkeleton grid items={6} />
      </SchoolHeadPageSkeleton>
    </RouteLoadingOverlay>
  );
}
