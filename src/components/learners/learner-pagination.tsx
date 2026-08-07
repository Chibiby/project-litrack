import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

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

  return (
    <div className="flex items-center justify-between border-t border-border/60 px-4 py-3 text-sm">
      <span className="text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        {isClient ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page <= 1}
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
              onClick={() => props.onPageChange(page + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <>
            <Button
              asChild
              size="sm"
              variant="outline"
              disabled={page <= 1}
              className={page <= 1 ? "pointer-events-none opacity-50" : ""}
            >
              <Link href={hrefFor(props.basePath, page - 1, props.searchParams)}>
                <ChevronLeft className="h-4 w-4" />
                Prev
              </Link>
            </Button>
            <Button
              asChild
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              className={page >= totalPages ? "pointer-events-none opacity-50" : ""}
            >
              <Link href={hrefFor(props.basePath, page + 1, props.searchParams)}>
                Next
                <ChevronRight className="h-4 w-4" />
              </Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
