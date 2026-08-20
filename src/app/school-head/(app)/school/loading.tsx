import { ListCardSkeleton } from "@/components/loading";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";
import { SCHOOL_WORKSPACE_TABS } from "@/components/school-head/workspace-tabs";

/**
 * Covers all three School workspace tabs.
 *
 * One boundary at the workspace root rather than one per tab: the three panels
 * share the header and tab bar, and the closest `loading.tsx` above a segment is
 * the one Next uses. Grade levels is the heaviest panel, so the grid skeleton
 * below is sized for it.
 */
export default function SchoolWorkspaceLoading() {
  return (
    <SchoolHeadPageSkeleton tabs={SCHOOL_WORKSPACE_TABS.length}>
      <ListCardSkeleton grid items={6} />
    </SchoolHeadPageSkeleton>
  );
}
