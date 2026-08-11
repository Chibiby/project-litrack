import { ListCardSkeleton } from "@/components/loading";

/**
 * Content-slot skeleton for grade levels. Sidebar stays mounted in RoleShell;
 * matches the card-grid Suspense fallback on the page.
 */
export default function SchoolHeadGradeLevelsLoading() {
  return (
    <div className="w-full space-y-6 p-4 lg:p-8">
      <ListCardSkeleton grid items={10} />
    </div>
  );
}
