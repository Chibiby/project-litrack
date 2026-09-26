"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LEARNER_PAGE_SIZE_OPTIONS } from "@/lib/learners/pagination";
import { PrefetchLink } from "@/components/nav/prefetch-link";
import { LinkStatusPulse, useListNavigate } from "@/components/nav/list-navigation";
import { adjacentPages } from "@/lib/nav/list-params";

/**
 * Roster footer, to the comp: the range on the left, numbered pages in the
 * middle, rows-per-page on the right.
 *
 * Deliberately separate from the shared `LearnerPagination`, which three other
 * tables still use with prev/next only — this one is the roster's, and changing
 * the shared component would have redesigned those pages by accident.
 */

/** Page numbers to render, collapsing long runs to `…` around the current page. */
export function pageWindow(page: number, totalPages: number): (number | "gap")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const out: (number | "gap")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) out.push("gap");
  for (let i = start; i <= end; i += 1) out.push(i);
  if (end < totalPages - 1) out.push("gap");
  out.push(totalPages);
  return out;
}

function hrefFor(
  basePath: string,
  page: number,
  searchParams: Record<string, string | undefined>
): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (v !== undefined && v !== "" && k !== "page") params.set(k, v);
  }
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export function LearnerListFooter({
  basePath,
  page,
  totalPages,
  totalCount,
  pageSize,
  searchParams,
}: {
  basePath: string;
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  searchParams: Record<string, string | undefined>;
}) {
  const navigate = useListNavigate();

  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

  // Only the page immediately before/after the current one is worth a hover
  // prefetch — the footer can render up to seven numbered links, and each
  // prefetch of this force-dynamic route re-runs auth plus Prisma work.
  const adjacent = adjacentPages(page, totalPages);

  function changePageSize(next: string) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v !== undefined && v !== "" && k !== "page" && k !== "perPage") {
        params.set(k, v);
      }
    }
    params.set("perPage", next);
    // Row count changed, so the old page index no longer means anything —
    // always land back on page 1.
    const qs = params.toString();
    navigate(qs ? `${basePath}?${qs}` : basePath);
  }

  return (
    <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-3 text-sm">
      <p className="min-w-0 text-muted-foreground">
        {totalCount === 0 ? (
          "No learners to show"
        ) : (
          <>
            Showing <span className="tabular-nums text-foreground">{from}</span>
            <span className="sm:hidden">–</span>
            <span className="hidden sm:inline"> to </span>
            <span className="tabular-nums text-foreground">{to}</span> of{" "}
            <span className="tabular-nums text-foreground">{totalCount}</span>{" "}
            learner{totalCount === 1 ? "" : "s"}
          </>
        )}
      </p>

      {totalPages > 1 ? (
        <nav aria-label="Learner list pages" className="flex shrink-0 items-center gap-1">
          <Button
            asChild={page > 1}
            size="icon"
            variant="outline"
            className="h-11 w-11 lg:h-8 lg:w-8"
            disabled={page <= 1}
            aria-label="Previous page"
          >
            {page > 1 ? (
              <PrefetchLink
                href={hrefFor(basePath, page - 1, searchParams)}
                intent={adjacent.includes(page - 1)}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                <LinkStatusPulse />
              </PrefetchLink>
            ) : (
              <ChevronLeft className="h-4 w-4" aria-hidden />
            )}
          </Button>

          <span className="whitespace-nowrap px-2 tabular-nums text-foreground sm:hidden">
            {page} / {totalPages}
          </span>
          {pageWindow(page, totalPages).map((entry, i) =>
            entry === "gap" ? (
              <span
                key={`gap-${i}`}
                aria-hidden
                className="hidden px-1 text-muted-foreground sm:inline"
              >
                …
              </span>
            ) : (
              <Button
                key={entry}
                asChild
                size="icon"
                variant={entry === page ? "default" : "outline"}
                className={cn("hidden h-11 w-11 tabular-nums sm:inline-flex lg:h-8 lg:w-8")}
                aria-current={entry === page ? "page" : undefined}
              >
                <PrefetchLink
                  href={hrefFor(basePath, entry, searchParams)}
                  aria-label={`Page ${entry}`}
                  intent={adjacent.includes(entry)}
                >
                  {entry}
                  <LinkStatusPulse />
                </PrefetchLink>
              </Button>
            )
          )}

          <Button
            asChild={page < totalPages}
            size="icon"
            variant="outline"
            className="h-11 w-11 lg:h-8 lg:w-8"
            disabled={page >= totalPages}
            aria-label="Next page"
          >
            {page < totalPages ? (
              <PrefetchLink
                href={hrefFor(basePath, page + 1, searchParams)}
                intent={adjacent.includes(page + 1)}
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
                <LinkStatusPulse />
              </PrefetchLink>
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden />
            )}
          </Button>
        </nav>
      ) : null}

      <div className="hidden items-center gap-2 md:flex">
        <label
          htmlFor="learner-rows-per-page"
          className="whitespace-nowrap text-muted-foreground"
        >
          Rows per page
        </label>
        <Select value={String(pageSize)} onValueChange={changePageSize}>
          <SelectTrigger
            id="learner-rows-per-page"
            className="h-11 w-[4.5rem] gap-1 py-1 lg:h-8"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LEARNER_PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
