"use client";

import * as React from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * One labelled control inside a FilterMenu: the caption above, the control
 * full width below. Wrapping in a `<label>` names the control with no id.
 */
export function FilterMenuField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

/**
 * One "Filters" button that holds every filter of a list page.
 *
 * The rule (owner, 2026-11-23): a page with more than one filter keeps only
 * its search box and its advisory filter in view, and puts every other filter
 * (and its sort) in this menu. A page with a single filter shows it inline;
 * do not wrap one control in a menu.
 *
 * The trigger shows how many filters are narrowing the list, so a filtered
 * list never looks like the full one. Children are the page's own controls,
 * stacked full width; give each a visible label.
 */
export function FilterMenu({
  activeCount = 0,
  onClear,
  clearDisabled,
  title = "Filters",
  align = "end",
  className,
  contentClassName,
  children,
}: {
  /** Filters narrowing the list now (not counting search or sort). */
  activeCount?: number;
  /** Shown as "Clear filters" at the bottom while any filter is set. */
  onClear?: () => void;
  clearDisabled?: boolean;
  title?: string;
  align?: "start" | "center" | "end";
  /** Trigger classes. */
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  const active = activeCount > 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={active ? `${title}, ${activeCount} on` : title}
          className={cn(
            "h-11 shrink-0 gap-2 rounded-md lg:h-9",
            active && "border-primary/50 text-primary",
            className
          )}
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          <span>{title}</span>
          {active ? (
            <span
              aria-hidden
              className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold leading-5 text-primary-foreground"
            >
              {activeCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        collisionPadding={16}
        className={cn(
          "w-[min(20rem,calc(100vw-2rem))] p-3",
          // Tall filter lists scroll inside the menu instead of off screen.
          "max-h-[min(36rem,var(--radix-popover-content-available-height))] overflow-y-auto",
          contentClassName
        )}
      >
        <p className="mb-3 text-sm font-semibold">{title}</p>
        <div className="grid gap-3">{children}</div>
        {onClear && active ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-3 h-11 w-full lg:h-9"
            disabled={clearDisabled}
            onClick={onClear}
          >
            <X className="size-4" aria-hidden /> Clear filters
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
