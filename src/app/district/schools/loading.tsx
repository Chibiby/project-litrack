import { TableSectionSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";

export default function DistrictSchoolsLoading() {
  return (
    <RouteLoadingOverlay>
      <div className="w-full space-y-6 p-4 lg:p-6">
        <TableSectionSkeleton rows={8} columns={5} />
      </div>
    </RouteLoadingOverlay>
  );
}
