import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { ListCardSkeleton } from "@/components/loading";

export default function AdminSummaryLoading() {
  return (
    <RouteLoadingOverlay>
      <div className="w-full space-y-6 p-4 lg:p-6">
        <ListCardSkeleton items={6} grid />
      </div>
    </RouteLoadingOverlay>
  );
}
