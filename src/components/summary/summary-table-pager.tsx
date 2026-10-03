import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SummaryTableNavLink } from "./summary-table-nav";
import { formatCount } from "./summary-format";
import { pageHref, type SchoolPaging } from "./summary-school-paging";

const STEP = cn(buttonVariants({ variant: "outline", size: "sm" }), "px-3");

/**
 * Previous / Next under one by-school table. The links navigate through the
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
  const { page, pageCount, pageSize, matchedSchools } = paging.page;
  if (pageCount <= 1) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, matchedSchools);
  const noun = paging.query ? "matching schools" : "schools";

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        Showing {formatCount(first)}–{formatCount(last)} of {formatCount(matchedSchools)} {noun}
      </p>
      <nav aria-label={`${sectionTitle} pages`} className="flex items-center gap-2">
        {page > 1 ? (
          <SummaryTableNavLink href={pageHref(paging, sectionId, page - 1)} className={STEP}>
            <ChevronLeft aria-hidden />
            Previous
          </SummaryTableNavLink>
        ) : (
          <span aria-disabled="true" className={cn(STEP, "pointer-events-none opacity-50")}>
            <ChevronLeft aria-hidden />
            Previous
          </span>
        )}
        <span className="min-w-20 text-center text-sm font-medium text-muted-foreground">
          Page {formatCount(page)} of {formatCount(pageCount)}
        </span>
        {page < pageCount ? (
          <SummaryTableNavLink href={pageHref(paging, sectionId, page + 1)} className={STEP}>
            Next
            <ChevronRight aria-hidden />
          </SummaryTableNavLink>
        ) : (
          <span aria-disabled="true" className={cn(STEP, "pointer-events-none opacity-50")}>
            Next
            <ChevronRight aria-hidden />
          </span>
        )}
      </nav>
    </div>
  );
}
