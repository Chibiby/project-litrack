import { DualListCardSkeleton } from "@/components/loading";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";

/**
 * Content-slot skeleton for announcements. Two panels because the page pairs the
 * compose form with the published list; sidebar stays mounted in RoleShell.
 */
export default function Loading() {
  return (
    <SchoolHeadPageSkeleton>
      <DualListCardSkeleton />
    </SchoolHeadPageSkeleton>
  );
}
