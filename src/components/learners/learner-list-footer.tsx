"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  const router = useRouter();

  const from = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, totalCount);

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
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }

  return (
    <div className="flex flex-col items-center gap-3 border-t border-border/60 px-4 py-3 text-sm md:flex-row md:justify-between">
      <p className="text-muted-foreground">
        {totalCount === 0 ? (
          "No learners to show"
        ) : (
          <>
            Showing <span className="tabular-nums text-foreground">{from}</span>{" "}
            to <span className="tabular-nums text-foreground">{to}</span> of{" "}
            <span className="tabular-nums text-foreground">{totalCount}</span>{" "}
            learner{totalCount === 1 ? "" : "s"}
          </>
        )}
      </p>

      {totalPages > 1 ? (
        <nav aria-label="Learner list pages" className="flex items-center gap-1">
          <Button
            asChild={page > 1}
            size="icon"
            variant="outline"
            className="h-8 w-8"
            disabled={page <= 1}
            aria-label="Previous page"
          >
            {page > 1 ? (
              <Link href={hrefFor(basePath, page - 1, searchParams)}>
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </Link>
            ) : (
              <ChevronLeft className="h-4 w-4" aria-hidden />
            )}
          </Button>

          {pageWindow(page, totalPages).map((entry, i) =>
            entry === "gap" ? (
              <span
                key={`gap-${i}`}
                aria-hidden
                className="px-1 text-muted-foreground"
              >
                …
              </span>
            ) : (
              <Button
                key={entry}
                asChild
                size="icon"
                variant={entry === page ? "default" : "outline"}
                className={cn("h-8 w-8 tabular-nums")}
                aria-current={entry === page ? "page" : undefined}
              >
                <Link
                  href={hrefFor(basePath, entry, searchParams)}
                  aria-label={`Page ${entry}`}
                >
                  {entry}
                </Link>
              </Button>
            )
          )}

          <Button
            asChild={page < totalPages}
            size="icon"
            variant="outline"
            className="h-8 w-8"
            disabled={page >= totalPages}
            aria-label="Next page"
          >
            {page < totalPages ? (
              <Link href={hrefFor(basePath, page + 1, searchParams)}>
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden />
            )}
          </Button>
        </nav>
      ) : null}

      <div className="flex items-center gap-2">
        <label
          htmlFor="learner-rows-per-page"
          className="whitespace-nowrap text-muted-foreground"
        >
          Rows per page
        </label>
        <Select value={String(pageSize)} onValueChange={changePageSize}>
          <SelectTrigger
            id="learner-rows-per-page"
            className="h-8 w-[4.5rem] gap-1 py-1"
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
