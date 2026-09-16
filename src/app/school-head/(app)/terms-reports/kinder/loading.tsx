import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";
import { SchoolHeadPageSkeleton } from "@/components/school-head/page-skeleton";
import { TermsReportBodySkeleton } from "@/components/terms/terms-report-skeleton";

/**
 * Content-slot skeleton for the School Head's read-only Kindergarten
 * checklist. `SchoolHeadPageSkeleton` reproduces `SchoolHeadPage`'s header
 * chrome (no tabs on this route); `TermsReportBodySkeleton` is the same
 * cards-then-table shape the teacher's End of Terms route already uses for
 * its own busy state, reused rather than one-off skeleton markup.
 */
export default function SchoolHeadKinderChecklistLoading() {
  return (
    <RouteLoadingOverlay>
      <SchoolHeadPageSkeleton>
        <TermsReportBodySkeleton />
      </SchoolHeadPageSkeleton>
    </RouteLoadingOverlay>
  );
}
