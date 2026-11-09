"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { PrefetchLink } from "@/components/nav/prefetch-link";
import { cn } from "@/lib/utils";

/**
 * The phone half of the table system (desktop half: components/ui/table.tsx).
 *
 * The table owns its breakpoint: `<ResponsiveTable>` is a size container, so
 * the switch to stacked rows happens when *the table's own box* is narrower
 * than 700px — a table in a narrow panel on a desktop gets rows too, not a
 * sideways scroll.
 *
 * Each stacked row follows six moves:
 * 1. Rank   — show columns by use, not position: identity · value · state.
 * 2. Stack  — two lines: identity left, value right; state and meta below.
 * 3. Slot   — the value always sits in the same right-hand slot with
 *             tabular figures, so the rows still read as a column of numbers.
 * 4. Label  — ambiguous meta gets a word ("Due Mar 04", "Grade 3"); a value
 *             whose unit is obvious does not.
 * 5. Reveal — fields that don't fit are expanded in place, never a new page.
 * 6. Breakpoint — see above.
 */

/**
 * Container widths at which the full table takes over. Most tables switch at
 * 700px; a wide roster (ten columns) passes 1100 so it stacks until its box
 * can hold every column. The classes are spelled out because Tailwind only
 * generates class names it can read in the source.
 */
const BREAKPOINT = {
  700: { table: "hidden @[700px]/rt:block", stacked: "@[700px]/rt:hidden" },
  900: { table: "hidden @[900px]/rt:block", stacked: "@[900px]/rt:hidden" },
  1100: { table: "hidden @[1100px]/rt:block", stacked: "@[1100px]/rt:hidden" },
} as const;

export type ResponsiveTableBreakpoint = keyof typeof BREAKPOINT;

export function ResponsiveTable({
  table,
  stacked,
  breakpoint = 700,
  className,
}: {
  /** The full `<Table>`, shown when the container is at least `breakpoint` wide. */
  table: React.ReactNode;
  /** The `<StackedList>`, shown below `breakpoint`. */
  stacked: React.ReactNode;
  /** Container width (px) where the table replaces the stacked rows. Default 700. */
  breakpoint?: ResponsiveTableBreakpoint;
  className?: string;
}) {
  const bp = BREAKPOINT[breakpoint];
  return (
    <div className={cn("@container/rt w-full min-w-0", className)}>
      <div className={bp.table}>{table}</div>
      <div className={bp.stacked}>{stacked}</div>
    </div>
  );
}

export function StackedList({
  children,
  className,
  "aria-label": ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <ul role="list" aria-label={ariaLabel} className={cn("divide-y divide-border/60", className)}>
      {children}
    </ul>
  );
}

export interface StackedDetail {
  label: string;
  value: React.ReactNode;
}

export interface StackedRowProps {
  /** Avatar or icon before the identity. */
  leading?: React.ReactNode;
  /** Identity — the name. One line, truncates. */
  title: React.ReactNode;
  /** Full identity text for the hover tooltip when `title` is not a string. */
  titleText?: string;
  /** Makes the identity a link to the record. */
  href?: string;
  /** The row's main value, right-aligned in its slot (never truncated). */
  value?: React.ReactNode;
  /** State — usually a status badge — on the second line. */
  state?: React.ReactNode;
  /** Extra second-line facts. Label anything ambiguous ("Due Mar 04"). */
  meta?: React.ReactNode;
  /** Hidden fields, revealed in place when the row is expanded. */
  details?: StackedDetail[];
  /** Row actions. Shown at the end of the row; always visible on touch. */
  actions?: React.ReactNode;
  /**
   * The row's primary inline control (an assignment select, a mark input).
   * Always visible, full width under the identity, never hidden in details.
   */
  children?: React.ReactNode;
  className?: string;
}

export function StackedRow({
  leading,
  title,
  titleText,
  href,
  value,
  state,
  meta,
  details,
  actions,
  children,
  className,
}: StackedRowProps) {
  const [open, setOpen] = React.useState(false);
  const detailsId = React.useId();
  const hasDetails = Boolean(details && details.length > 0);
  const tooltip = titleText ?? (typeof title === "string" ? title : undefined);

  const identity = href ? (
    <PrefetchLink
      href={href}
      title={tooltip}
      className="block min-w-0 truncate font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {title}
    </PrefetchLink>
  ) : (
    <span title={tooltip} className="block min-w-0 truncate font-medium text-foreground">
      {title}
    </span>
  );

  const secondLine =
    state || meta ? (
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {state}
        {meta}
      </div>
    ) : null;

  return (
    <li className={cn("px-3 py-3", className)}>
      <div className="flex items-start gap-3">
        {leading ? <div className="shrink-0 pt-0.5">{leading}</div> : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0 flex-1">{identity}</div>
            {value !== undefined && value !== null ? (
              <div className="shrink-0 whitespace-nowrap text-right font-semibold tabular-nums text-foreground">
                {value}
              </div>
            ) : null}
          </div>
          {secondLine}
        </div>
        {hasDetails || actions ? (
          <div className="flex shrink-0 items-center gap-0.5 self-center">
            {actions}
            {hasDetails ? (
              <button
                type="button"
                aria-expanded={open}
                aria-controls={detailsId}
                aria-label={`${open ? "Hide" : "Show"} details${tooltip ? ` for ${tooltip}` : ""}`}
                onClick={() => setOpen((o) => !o)}
                className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronDown
                  aria-hidden
                  className={cn("size-4 transition-transform duration-200", open && "rotate-180")}
                />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {children ? <div className="mt-2 min-w-0">{children}</div> : null}
      {hasDetails ? (
        <dl
          id={detailsId}
          hidden={!open}
          className="mt-3 grid [&[hidden]]:hidden grid-cols-2 gap-x-4 gap-y-2 rounded-md bg-muted/40 p-3 text-sm"
        >
          {details!.map((d) => (
            <div key={d.label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{d.label}</dt>
              <dd className="mt-0.5 min-w-0 break-words">{d.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}
