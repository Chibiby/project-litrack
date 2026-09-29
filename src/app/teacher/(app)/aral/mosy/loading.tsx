import { TableSectionSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { Skeleton } from "@/components/ui/skeleton";

/** Content-slot only — RoleShell sidebar stays mounted during soft nav. */
export default function TeacherAralMosyLoading() {
  return (
    <RouteLoadingOverlay>
      <div className="w-full space-y-4 p-4 lg:p-6">
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 2xl:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <TableSectionSkeleton rows={8} columns={8} />
      </div>
    </RouteLoadingOverlay>
  );
}
