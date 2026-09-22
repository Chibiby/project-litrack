import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PrefetchLink } from "@/components/nav/prefetch-link";
import { LinkStatusPulse } from "@/components/nav/list-navigation";
import { adjacentPages } from "@/lib/nav/list-params";

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
   * Prev/Next controls can report "busy" without going anywhere near the
   * shared list-navigation provider or the router — this mode never
   * navigates, it only calls back.
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

export function LearnerPagination(props: Props) {
  const { page, totalPages } = props;
  if (totalPages <= 1) return null;

  const isClient = props.mode === "client";

  if (isClient) {
    const pending = props.pending ?? false;
    return (
      <div className="flex items-center justify-between border-t border-border/60 px-4 py-3 text-sm">
        <span className="text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page <= 1}
            aria-disabled={pending || undefined}
            onClick={() => props.onPageChange(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            aria-disabled={pending || undefined}
            onClick={() => props.onPageChange(page + 1)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    );
  }

  const adjacent = adjacentPages(page, totalPages);
  const prevPage = page - 1;
  const nextPage = page + 1;
  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;

  return (
    <div className="flex items-center justify-between border-t border-border/60 px-4 py-3 text-sm">
      <span className="text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <Button
          asChild
          size="sm"
          variant="outline"
          disabled={prevDisabled}
          className={prevDisabled ? "pointer-events-none opacity-50" : ""}
        >
          <PrefetchLink
            href={hrefFor(props.basePath, prevPage, props.searchParams)}
            intent={adjacent.includes(prevPage)}
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
            <LinkStatusPulse />
          </PrefetchLink>
        </Button>
        <Button
          asChild
          size="sm"
          variant="outline"
          disabled={nextDisabled}
          className={nextDisabled ? "pointer-events-none opacity-50" : ""}
        >
          <PrefetchLink
            href={hrefFor(props.basePath, nextPage, props.searchParams)}
            intent={adjacent.includes(nextPage)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
            <LinkStatusPulse />
          </PrefetchLink>
        </Button>
      </div>
    </div>
  );
}
