"use client";

import { PageNav } from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LEARNER_PAGE_SIZE_OPTIONS } from "@/lib/learners/pagination";
import { useListNavigate } from "@/components/nav/list-navigation";

/**
 * Roster footer, to the comp: the range on the left, numbered pages in the
 * middle, rows-per-page on the right.
 *
 * Pages use the shared `PageNav`; rows per page is the roster's own.
 */

export { pageWindow } from "@/lib/ui/page-window";

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

      <PageNav
        page={page}
        totalPages={totalPages}
        label="Learner list pages"
        hrefFor={(p) => hrefFor(basePath, p, searchParams)}
      />

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
            className="w-[4.5rem] gap-1 py-1"
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
