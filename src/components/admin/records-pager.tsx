"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PrefetchLink } from "@/components/nav/prefetch-link";
import {
  LinkStatusPulse,
  useListNavigate,
} from "@/components/nav/list-navigation";
import { pageWindow } from "@/components/learners/learner-list-footer";
import { adjacentPages } from "@/lib/nav/list-params";
import { RECORDS_PAGE_SIZE_OPTIONS } from "@/lib/admin/records-pagination";

/**
 * The link's loading dot, pinned to the button's corner so it never pushes
 * the page number or arrow off centre.
 */
function CornerPulse() {
  return (
    <span className="pointer-events-none absolute right-0.5 top-0.5 [&>span]:ml-0 [&>span]:size-2">
      <LinkStatusPulse />
    </span>
  );
}

/**
 * Footer for a server-paginated records list: the range on the left, numbered
 * pages in the middle (prev / "3 / 7" / next on a phone), rows per page on the
 * right. Reads and writes `?page=` and `?perPage=` on `basePath`, keeping every
 * other param. Must render inside a `ListNavigationProvider`, and outside its
 * `ListBusyRegion` (see `ListBusyRegion` for why).
 */
export function RecordsPager({
  basePath,
  page,
  totalPages,
  totalCount,
  pageSize,
  noun,
  idPrefix,
}: {
  basePath: string;
  page: number;
  totalPages: number;
  totalCount: number;
  pageSize: number;
  /** Plural, lower case: "deleted teachers". */
  noun: string;
  idPrefix: string;
}) {
  const searchParams = useSearchParams();
  const navigate = useListNavigate();

  const hrefWith = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const qs = next.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const pageHref = (p: number) => hrefWith({ page: p > 1 ? String(p) : null });

  if (totalCount === 0) return null;

  const from = (Math.min(page, totalPages) - 1) * pageSize + 1;
  const to = Math.min(Math.min(page, totalPages) * pageSize, totalCount);
  const adjacent = adjacentPages(page, totalPages);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3 text-sm">
      {page > totalPages ? (
        // Past the end: no rows are shown, so give the total, not a range.
        <p className="min-w-0 text-muted-foreground">
          <span className="tabular-nums text-foreground">
            {totalCount.toLocaleString()}
          </span>{" "}
          {noun}
        </p>
      ) : (
        <p className="min-w-0 text-muted-foreground">
          Showing{" "}
          <span className="tabular-nums text-foreground">
            {from.toLocaleString()}
          </span>
          <span className="sm:hidden">–</span>
          <span className="hidden sm:inline"> to </span>
          <span className="tabular-nums text-foreground">
            {to.toLocaleString()}
          </span>{" "}
          of{" "}
          <span className="tabular-nums text-foreground">
            {totalCount.toLocaleString()}
          </span>{" "}
          <span className="hidden sm:inline">{noun}</span>
        </p>
      )}

      {totalPages > 1 ? (
        <nav
          aria-label={`${noun} pages`}
          className="flex shrink-0 items-center gap-1"
        >
          <Button
            asChild={page > 1}
            size="icon"
            variant="outline"
            className="relative h-11 w-11 xl:h-8 xl:w-8"
            disabled={page <= 1}
            aria-label="Previous page"
          >
            {page > 1 ? (
              <PrefetchLink
                href={pageHref(page > totalPages ? totalPages : page - 1)}
                intent={adjacent.includes(page - 1)}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                <CornerPulse />
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
                className="relative hidden h-11 w-11 tabular-nums sm:inline-flex xl:h-8 xl:w-8"
                aria-current={entry === page ? "page" : undefined}
              >
                <PrefetchLink
                  href={pageHref(entry)}
                  aria-label={`Page ${entry}`}
                  intent={adjacent.includes(entry)}
                >
                  {entry}
                  <CornerPulse />
                </PrefetchLink>
              </Button>
            ),
          )}

          <Button
            asChild={page < totalPages}
            size="icon"
            variant="outline"
            className="relative h-11 w-11 xl:h-8 xl:w-8"
            disabled={page >= totalPages}
            aria-label="Next page"
          >
            {page < totalPages ? (
              <PrefetchLink
                href={pageHref(page + 1)}
                intent={adjacent.includes(page + 1)}
              >
                <ChevronRight className="h-4 w-4" aria-hidden />
                <CornerPulse />
              </PrefetchLink>
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden />
            )}
          </Button>
        </nav>
      ) : null}

      <div className="hidden items-center gap-2 md:flex">
        <label
          htmlFor={`${idPrefix}-per-page`}
          className="whitespace-nowrap text-muted-foreground"
        >
          Rows per page
        </label>
        <Select
          value={String(pageSize)}
          // A new page size makes the old page index meaningless: back to page 1.
          onValueChange={(value) =>
            navigate(hrefWith({ perPage: value, page: null }))
          }
        >
          <SelectTrigger
            id={`${idPrefix}-per-page`}
            className="h-11 w-[4.75rem] gap-1 py-1 xl:h-8"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RECORDS_PAGE_SIZE_OPTIONS.map((size) => (
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
