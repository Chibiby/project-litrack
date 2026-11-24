"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PrefetchLink } from "@/components/nav/prefetch-link";
import { LinkStatusPulse, useListPending } from "@/components/nav/list-navigation";
import { adjacentPages } from "@/lib/nav/list-params";
import { pageWindow } from "@/lib/ui/page-window";
import { cn } from "@/lib/utils";

/*
 * shadcn/ui Pagination, adapted to LITRACK: our Button sizes (44px touch
 * floor below `lg`), real links that prefetch the neighbouring pages, and the
 * shared list-navigation loading dot. The primitives below follow shadcn's
 * API; `PageNav` puts them together for a server-paginated list.
 */

export function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return <nav data-slot="pagination" className={cn("flex", className)} {...props} />;
}

export function PaginationContent({ className, ...props }: React.ComponentProps<"ul">) {
  return <ul data-slot="pagination-content" className={cn("flex flex-row items-center gap-1", className)} {...props} />;
}

export function PaginationItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="pagination-item" className={className} {...props} />;
}

/** Classes for one page link: the current page is outlined, the rest ghost. */
export function paginationLinkClass({
  isActive = false,
  size = "icon",
  className,
}: {
  isActive?: boolean;
  size?: "icon" | "default";
  className?: string;
} = {}) {
  return cn(
    buttonVariants({ variant: isActive ? "outline" : "ghost", size }),
    "relative tabular-nums",
    size === "default" && "gap-1 px-2.5",
    className
  );
}

export function PaginationEllipsis({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      data-slot="pagination-ellipsis"
      className={cn("flex size-9 items-center justify-center text-muted-foreground", className)}
      {...props}
    >
      <MoreHorizontal className="size-4" />
    </span>
  );
}

/** The link element a pager renders: `href`, classes, accessible name, contents. */
export type PageLinkComponent = React.ComponentType<{
  href: string;
  className?: string;
  children: React.ReactNode;
  "aria-label"?: string;
  "aria-current"?: "page";
}>;

type PageNavProps = {
  page: number;
  totalPages: number;
  /** Accessible name of the nav, e.g. "Teachers pages". */
  label: string;
  className?: string;
} & (
  | {
      /** URL of a page. Pages navigate as real links. */
      hrefFor: (page: number) => string;
      /**
       * Link element to render instead of the default prefetching link with
       * the list-navigation loading dot (e.g. a table frame's own link).
       */
      linkAs?: PageLinkComponent;
      onPageChange?: never;
      pending?: never;
    }
  | {
      /** Pages change in place, without navigating. */
      onPageChange: (page: number) => void;
      /** A page change is in flight: the controls report busy. */
      pending?: boolean;
      hrefFor?: never;
      linkAs?: never;
    }
);

/**
 * Previous · 1 2 3 … 9 · Next. On a phone the numbers give way to "3 / 9" so
 * the row never wraps. Renders nothing for a single page. A page number past
 * the end (an old bookmark) sends Previous to the real last page.
 */
export function PageNav(props: PageNavProps) {
  const { page, totalPages, label, className } = props;
  // While a list navigation is in flight every link reports busy with
  // aria-disabled — never `disabled`, which would drop keyboard focus.
  const listPending = useListPending();
  if (totalPages <= 1) return null;

  const adjacent = adjacentPages(page, totalPages);
  const previousPage = page > totalPages ? totalPages : page - 1;

  function control(
    target: number,
    content: React.ReactNode,
    options: { className: string; ariaLabel?: string; current?: boolean }
  ) {
    const ariaCurrent = options.current ? ("page" as const) : undefined;
    if (props.onPageChange) {
      const onPageChange = props.onPageChange;
      return (
        <button
          type="button"
          className={options.className}
          aria-label={options.ariaLabel}
          aria-current={ariaCurrent}
          aria-disabled={props.pending || undefined}
          onClick={() => {
            if (!props.pending) onPageChange(target);
          }}
        >
          {content}
        </button>
      );
    }
    const href = props.hrefFor(target);
    const LinkAs = props.linkAs;
    if (LinkAs) {
      return (
        <LinkAs href={href} className={options.className} aria-label={options.ariaLabel} aria-current={ariaCurrent}>
          {content}
        </LinkAs>
      );
    }
    return (
      <PrefetchLink
        href={href}
        intent={adjacent.includes(target)}
        className={options.className}
        aria-label={options.ariaLabel}
        aria-current={ariaCurrent}
        aria-disabled={listPending || undefined}
      >
        {content}
        <LinkStatusPulse overlay />
      </PrefetchLink>
    );
  }

  const stepClass = paginationLinkClass({ size: "default" });

  return (
    <Pagination aria-label={label} className={cn("shrink-0", className)}>
      <PaginationContent>
        <PaginationItem>
          {page > 1 ? (
            control(
              previousPage,
              <>
                <ChevronLeft aria-hidden />
                <span className="hidden sm:inline">Previous</span>
              </>,
              { className: stepClass, ariaLabel: "Previous page" }
            )
          ) : (
            // No page before this one: a real disabled control, not a link.
            <button type="button" disabled className={stepClass} aria-label="Previous page">
              <ChevronLeft aria-hidden />
              <span className="hidden sm:inline">Previous</span>
            </button>
          )}
        </PaginationItem>

        <PaginationItem className="sm:hidden">
          <span className="whitespace-nowrap px-2 text-sm tabular-nums text-foreground">
            {page.toLocaleString()} / {totalPages.toLocaleString()}
          </span>
        </PaginationItem>

        {pageWindow(page, totalPages).map((entry, i) => (
          <PaginationItem key={entry === "gap" ? `gap-${i}` : entry} className="hidden sm:block">
            {entry === "gap" ? (
              <PaginationEllipsis />
            ) : (
              control(entry, entry.toLocaleString(), {
                className: paginationLinkClass({ isActive: entry === page }),
                ariaLabel: `Page ${entry}`,
                current: entry === page,
              })
            )}
          </PaginationItem>
        ))}

        <PaginationItem>
          {page < totalPages ? (
            control(
              page + 1,
              <>
                <span className="hidden sm:inline">Next</span>
                <ChevronRight aria-hidden />
              </>,
              { className: stepClass, ariaLabel: "Next page" }
            )
          ) : (
            <button type="button" disabled className={stepClass} aria-label="Next page">
              <span className="hidden sm:inline">Next</span>
              <ChevronRight aria-hidden />
            </button>
          )}
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
