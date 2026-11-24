"use client";

import { useSearchParams } from "next/navigation";
import { PageNav } from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useListNavigate } from "@/components/nav/list-navigation";
import { RECORDS_PAGE_SIZE_OPTIONS } from "@/lib/admin/records-pagination";

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

      <PageNav page={page} totalPages={totalPages} label={`${noun} pages`} hrefFor={pageHref} />

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
            className="w-[4.75rem] gap-1 py-1"
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
