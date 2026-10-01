"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
import { LinkStatusPulse, useListPending } from "@/components/nav/list-navigation";

/** `basePath` with the current query string and `page` set (page 1 drops it). */
export function useListPageHref(basePath: string): (page: number) => string {
  const searchParams = useSearchParams();
  return (page: number) => {
    const next = new URLSearchParams(searchParams.toString());
    if (page > 1) next.set("page", String(page));
    else next.delete("page");
    const qs = next.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
}

/**
 * A page number past the last page (an old bookmark, a list that shrank). The
 * list is not empty, so "nothing here yet" would be wrong — say where the rows
 * are and offer the way back.
 */
export function PageOutOfRangeState({
  basePath,
  page,
  totalPages,
  totalCount,
  noun,
}: {
  basePath: string;
  page: number;
  totalPages: number;
  totalCount: number;
  noun: string;
}) {
  const hrefFor = useListPageHref(basePath);
  return (
    <EmptyState
      title={`Page ${page.toLocaleString()} is past the end`}
      description={`There ${totalPages === 1 ? "is 1 page" : `are ${totalPages.toLocaleString()} pages`} of ${noun} (${totalCount.toLocaleString()} in all).`}
      actionHref={hrefFor(1)}
      actionLabel="Go to page 1"
      icon={SearchX}
    />
  );
}

/** Previous / next pager for a server-paginated list. Renders inside a `ListNavigationProvider`. */
export function ListPager({
  basePath,
  page,
  pageSize,
  totalPages,
  totalCount,
  noun,
}: {
  basePath: string;
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  /** Plural, lower case: "accounts", "learners". */
  noun: string;
}) {
  const pending = useListPending();
  const hrefFor = useListPageHref(basePath);
  const outOfRange = page > totalPages;
  const firstItem = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, totalCount);
  const canGoBack = page > 1;
  const canGoForward = page < totalPages;
  // Past the end, "Previous" lands on the real last page rather than page - 1,
  // which would still be past the end.
  const previousPage = outOfRange ? totalPages : page - 1;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-3 sm:px-4">
      <span className="text-xs text-muted-foreground">
        {outOfRange
          ? `${totalCount.toLocaleString()} ${noun} on ${totalPages.toLocaleString()} ${totalPages === 1 ? "page" : "pages"}`
          : `Showing ${firstItem.toLocaleString()}–${lastItem.toLocaleString()} of ${totalCount.toLocaleString()} ${noun}`}
      </span>
      <nav className="flex items-center gap-1" aria-label={`${noun} pages`}>
        <Button
          asChild={canGoBack}
          variant="ghost"
          size="icon"
          disabled={!canGoBack}
          aria-disabled={canGoBack && pending ? true : undefined}
          aria-label="Previous page"
        >
          {canGoBack ? (
            <Link href={hrefFor(previousPage)}>
              <ChevronLeft aria-hidden />
              <LinkStatusPulse />
            </Link>
          ) : (
            <span>
              <ChevronLeft aria-hidden />
            </span>
          )}
        </Button>
        <span className="min-w-14 text-center text-xs font-medium text-muted-foreground">
          {page} / {totalPages}
        </span>
        <Button
          asChild={canGoForward}
          variant="ghost"
          size="icon"
          disabled={!canGoForward}
          aria-disabled={canGoForward && pending ? true : undefined}
          aria-label="Next page"
        >
          {canGoForward ? (
            <Link href={hrefFor(page + 1)}>
              <ChevronRight aria-hidden />
              <LinkStatusPulse />
            </Link>
          ) : (
            <span>
              <ChevronRight aria-hidden />
            </span>
          )}
        </Button>
      </nav>
    </div>
  );
}
