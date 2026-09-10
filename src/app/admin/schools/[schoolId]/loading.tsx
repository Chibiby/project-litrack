import { TableSectionSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";

/**
 * Two tables and a profile card. Matches the shape of the real page closely
 * enough that nothing jumps when the data lands.
 */
export default function AdminSchoolDetailLoading() {
  return (
    <RouteLoadingOverlay>
      <div className="w-full space-y-6 p-4 lg:p-6">
        <TableSectionSkeleton rows={3} columns={4} />
        <TableSectionSkeleton rows={6} columns={4} />
      </div>
    </RouteLoadingOverlay>
  );
}
