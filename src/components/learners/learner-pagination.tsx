"use client";

import { PageNav } from "@/components/ui/pagination";

type LinkProps = {
  mode?: "link";
  basePath: string;
  page: number;
  totalPages: number;
  searchParams: Record<string, string | undefined>;
};

type ClientProps = {
  mode: "client";
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /**
   * Set while the caller's own client-side page change is in flight, so the
   * controls can report "busy" without going anywhere near the shared
   * list-navigation provider or the router — this mode never navigates, it
   * only calls back.
   */
  pending?: boolean;
};

type Props = LinkProps | ClientProps;

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

/** "Page 2 of 9" and the numbered pager, under a list. Hidden for one page. */
export function LearnerPagination(props: Props) {
  const { page, totalPages } = props;
  if (totalPages <= 1) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-3 text-sm">
      <span className="text-muted-foreground">
        Page {page.toLocaleString()} of {totalPages.toLocaleString()}
      </span>
      {props.mode === "client" ? (
        <PageNav
          page={page}
          totalPages={totalPages}
          label="List pages"
          onPageChange={props.onPageChange}
          pending={props.pending}
        />
      ) : (
        <PageNav
          page={page}
          totalPages={totalPages}
          label="List pages"
          hrefFor={(p) => hrefFor(props.basePath, p, props.searchParams)}
        />
      )}
    </div>
  );
}
