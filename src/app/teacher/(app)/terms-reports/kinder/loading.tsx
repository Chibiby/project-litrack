import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { TermsReportRouteSkeleton } from "@/components/terms/terms-report-skeleton";

/**
 * Busy state for the Kindergarten End-of-Term checklist.
 *
 * Content slot only: `RoleShell`'s sidebar and header stay mounted across a
 * soft nav. Reuses the numeric sheet's skeleton — same banner/card/panel
 * block shapes, so the handover into either page does not change shape.
 */
export default function TeacherKinderChecklistLoading() {
  return (
    <RouteLoadingOverlay>
      <TermsReportRouteSkeleton />
    </RouteLoadingOverlay>
  );
}
