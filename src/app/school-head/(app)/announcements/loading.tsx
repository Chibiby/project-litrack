import { DualListCardSkeleton } from "@/components/loading";

/**
 * Content-slot skeleton for announcements. Sidebar stays mounted in RoleShell;
 * matches the form + published-list layout.
 */
export default function SchoolHeadAnnouncementsLoading() {
  return (
    <div className="w-full space-y-6 p-4 lg:p-8">
      <DualListCardSkeleton />
    </div>
  );
}
