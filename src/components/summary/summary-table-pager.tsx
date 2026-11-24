"use client";

import { PageNav, type PageLinkComponent } from "@/components/ui/pagination";
import { SummaryTableNavLink } from "./summary-table-nav";
import { formatCount } from "./summary-format";
import { pageHref, pagingInfo, type SchoolPaging } from "./summary-school-paging";

const PagerLink: PageLinkComponent = (props) => <SummaryTableNavLink {...props} spinner="corner" />;

/**
 * Numbered pages under one by-school table. The links navigate through the
 * table's own frame (`SummaryTableFrame`) without scrolling, so paging keeps
 * the reader on this table. Hidden when every school fits on one page.
 */
export function SummaryTablePager({
  paging,
  sectionId,
  sectionTitle,
}: {
  paging: SchoolPaging;
  sectionId: string;
  sectionTitle: string;
}) {
  const { page, pageCount, pageSize, matched: matchedSchools, unit } = pagingInfo(paging);
  if (pageCount <= 1) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, matchedSchools);
  const noun = paging.query ? `matching ${unit}` : unit;

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        Showing {formatCount(first)}–{formatCount(last)} of {formatCount(matchedSchools)} {noun}
      </p>
      <PageNav
        page={page}
        totalPages={pageCount}
        label={`${sectionTitle} pages`}
        hrefFor={(p) => pageHref(paging, sectionId, p)}
        linkAs={PagerLink}
      />
    </div>
  );
}
