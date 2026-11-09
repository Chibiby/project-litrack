import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The app's data table — six decisions, applied once here so every table
 * gets them (see docs/tables.md):
 *
 * 1. Align   — text left; numbers right with tabular figures (`numeric`).
 * 2. Rows    — one hairline between rows, no zebra stripes; hover highlights.
 * 3. Density — row height is a choice: compact 40 / default 48 / comfortable 56.
 * 4. Sticky  — `stickyHeader` pins the header inside a height-capped scroll
 *              area; `stickyFirstColumn` pins the identity column on
 *              sideways scroll.
 * 5. Cells   — a missing value is `<NoValue />` ("—"), never blank; long text
 *              truncates to one line via `<CellText>` with the full text on
 *              hover; numbers never truncate.
 * 6. Actions — `<RowActions>` hides row actions until the row is hovered or
 *              focused on mouse devices; touch screens always see them.
 *
 * For phones, pair the table with `<StackedList>` inside `<ResponsiveTable>`
 * (components/ui/responsive-table.tsx).
 */

export type TableDensity = "compact" | "default" | "comfortable";

const DENSITY: Record<TableDensity, string> = {
  compact: "[&_tbody_tr]:h-10",
  default: "[&_tbody_tr]:h-12",
  comfortable: "[&_tbody_tr]:h-14",
};

export interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  /** Row height. Default 48px. */
  density?: TableDensity;
  /**
   * Pin the header while the body scrolls. Only takes effect when the scroll
   * area has a height cap — pass one through `containerClassName`
   * (e.g. `max-h-[70vh]`).
   */
  stickyHeader?: boolean;
  /** Pin the first (identity) column while the table scrolls sideways. */
  stickyFirstColumn?: boolean;
  /** Classes for the scroll container around the `<table>`. */
  containerClassName?: string;
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  (
    {
      className,
      density = "default",
      stickyHeader = false,
      stickyFirstColumn = false,
      containerClassName,
      ...props
    },
    ref
  ) => (
    <div className={cn("relative w-full overflow-auto", containerClassName)}>
      <table
        ref={ref}
        data-density={density}
        className={cn(
          "w-full caption-bottom text-sm",
          DENSITY[density],
          stickyHeader &&
            "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-20 [&_thead_th]:bg-card [&_thead_th]:shadow-[inset_0_-1px_0_hsl(var(--border))]",
          stickyFirstColumn &&
            "[&_tr>*:first-child]:sticky [&_tr>*:first-child]:left-0 [&_tr>*:first-child]:z-10 [&_tr>*:first-child]:bg-card [&_tr>*:first-child]:shadow-[inset_-1px_0_0_hsl(var(--border))] [&_thead_tr>*:first-child]:z-30",
          className
        )}
        {...props}
      />
    </div>
  )
);
Table.displayName = "Table";

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn("[&_tr]:border-b [&_tr]:border-border", className)} {...props} />
));
TableHeader.displayName = "TableHeader";

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />
));
TableBody.displayName = "TableBody";

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        // One hairline; hover does the rest. `group/row` drives <RowActions>.
        "group/row border-b border-border/60 transition-colors hover:bg-muted/50 focus-within:bg-muted/40 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
);
TableRow.displayName = "TableRow";

export interface TableHeadProps extends React.ThHTMLAttributes<HTMLTableCellElement> {
  /** Right-align the heading over a numeric column. */
  numeric?: boolean;
}

const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, numeric = false, ...props }, ref) => (
    <th
      ref={ref}
      className={cn(
        "h-10 whitespace-nowrap px-4 text-left align-middle text-xs font-semibold uppercase tracking-wide text-muted-foreground [&:has([role=checkbox])]:pr-0",
        numeric && "text-right",
        className
      )}
      {...props}
    />
  )
);
TableHead.displayName = "TableHead";

export interface TableCellProps extends React.TdHTMLAttributes<HTMLTableCellElement> {
  /** Numbers: right-aligned, tabular figures, never wrapped or truncated. */
  numeric?: boolean;
}

const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(
  ({ className, numeric = false, ...props }, ref) => (
    <td
      ref={ref}
      className={cn(
        "px-4 py-2 align-middle [&:has([role=checkbox])]:pr-0",
        numeric && "whitespace-nowrap text-right tabular-nums",
        className
      )}
      {...props}
    />
  )
);
TableCell.displayName = "TableCell";

/**
 * One line of text that truncates with "…" and shows the full value on
 * hover. Give the cell (or this) a max width so there is something to
 * truncate against.
 */
function CellText({
  children,
  title,
  className,
}: {
  children: React.ReactNode;
  /** Full text for the hover tooltip; defaults to `children` when it is a string. */
  title?: string;
  className?: string;
}) {
  const full = title ?? (typeof children === "string" ? children : undefined);
  return (
    <span title={full} className={cn("block min-w-0 truncate", className)}>
      {children}
    </span>
  );
}

/** A missing value: a dash, never a blank cell. */
function NoValue({ label = "Not set", className }: { label?: string; className?: string }) {
  return (
    <span className={cn("text-muted-foreground/70", className)}>
      <span aria-hidden>—</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * Row actions, revealed on row hover or keyboard focus on mouse devices.
 * Touch screens (no hover) always show them. Stays visible while a menu
 * inside it is open.
 */
function RowActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-1 transition-opacity duration-150",
        "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/row:opacity-100 [@media(hover:hover)]:group-focus-within/row:opacity-100 [@media(hover:hover)]:has-[[data-state=open]]:opacity-100",
        className
      )}
    >
      {children}
    </div>
  );
}

export {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  CellText,
  NoValue,
  RowActions,
};
