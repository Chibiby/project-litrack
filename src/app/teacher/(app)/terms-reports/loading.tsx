import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { TermsReportRouteSkeleton } from "@/components/terms/terms-report-skeleton";

/**
 * Busy state for the End of Terms sheet.
 *
 * Content slot only: `RoleShell`'s sidebar and header stay mounted across a
 * soft nav. Draws the same banner, cards and table blocks the page's own
 * Suspense fallback continues, so the handover does not change shape.
 */
export default function TeacherTermsReportsLoading() {
  return (
    <RouteLoadingOverlay>
      <TermsReportRouteSkeleton />
    </RouteLoadingOverlay>
  );
}
