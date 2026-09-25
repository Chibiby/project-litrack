import { SUMMARY_FACET_META } from "@/lib/summary/facet-meta";
import type { SummaryFacetId } from "@/lib/summary/types";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { SUMMARY_FACET_ICON } from "./summary-facet-index";

/**
 * The banded page hero for one summary facet, the same `SchoolHeadHero` the
 * School Head's list pages open with. `portal` names whose summary it is:
 * a district admin's (`/district/summary`) or the division's (`/admin/summary`).
 */
export function SummaryPageHero({
  facetId,
  portal,
  meta,
}: {
  facetId: SummaryFacetId;
  portal: "district" | "division";
  /** Optional third line, e.g. the admin's scope. */
  meta?: string;
}) {
  const facet = SUMMARY_FACET_META[facetId];
  return (
    <SchoolHeadHero
      eyebrow={portal === "district" ? "District summary" : "Division summary"}
      eyebrowIcon={SUMMARY_FACET_ICON[facetId]}
      title={facet.label}
      subtitle={facet.description}
      meta={meta}
    />
  );
}
