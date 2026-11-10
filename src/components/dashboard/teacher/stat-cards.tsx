import { PrefetchLink } from "@/components/nav/prefetch-link";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { ArrowUpRight, type LucideIcon } from "lucide-react";

/**
 * The shared stat card: a glass icon tile in a left column; the figure, then
 * the title, then its hint stacked in a right column.
 *
 * A card with a destination is itself the link — there is no separate button.
 * It lifts, deepens its shadow, rings in its tone and shows an arrow on hover
 * or keyboard focus, and presses in on click, so it reads as clickable.
 *
 * Each card keeps a faint wash of its tone in the top-left corner and a plain
 * glass icon tile. This is the one stat card design for the whole app: every
 * figure row uses it rather than its own card.
 */

export type StatTone =
  | "violet"
  | "amber"
  | "emerald"
  | "primary"
  | "pink"
  /**
   * A closed or dormant figure — a locked month, a window that has shut. Theme
   * tokens rather than a colour, because "no longer active" is the absence of a
   * state, and the weekly attendance panel already marks its locked week the
   * same way (`bg-muted-foreground`).
   */
  | "neutral";

/** The icon's colour. The tile behind it is plain glass (`TILE_GLASS`). */
const TILE: Record<StatTone, string> = {
  violet: "text-violet-700 dark:text-violet-200",
  amber: "text-amber-700 dark:text-amber-200",
  emerald: "text-emerald-700 dark:text-emerald-200",
  primary: "text-blue-700 dark:text-blue-200",
  pink: "text-pink-700 dark:text-pink-200",
  neutral: "text-muted-foreground",
};

/**
 * Plain, uncoloured glassmorphism for the icon tile, the same recipe as the
 * header and the sidebar highlight: a translucent white fill, backdrop blur, a
 * thin bright border, a top-edge highlight and a soft shadow.
 */
const TILE_GLASS =
  "border border-white/60 bg-glass/40 dark:bg-glass/10 shadow-[0_4px_12px_rgb(15_23_42/0.08),inset_0_1px_0_rgb(255_255_255/0.7)] backdrop-blur-md dark:border-white/10 dark:shadow-[0_4px_12px_rgb(0_0_0/0.3),inset_0_1px_0_rgb(255_255_255/0.08)]";

/** Hover arrow colour. */
const LINK: Record<StatTone, string> = {
  violet: "text-violet-700 dark:text-violet-300",
  amber: "text-amber-700 dark:text-amber-400",
  emerald: "text-emerald-700 dark:text-emerald-400",
  primary: "text-blue-700 dark:text-blue-400",
  pink: "text-pink-700 dark:text-pink-400",
  neutral: "text-muted-foreground",
};

/** Border colour a card rings in on hover / focus. */
const HOVER_RING: Record<StatTone, string> = {
  violet: "hover:border-violet-300 focus-within:border-violet-300 dark:hover:border-violet-700 dark:focus-within:border-violet-700",
  amber: "hover:border-amber-300 focus-within:border-amber-300 dark:hover:border-amber-700 dark:focus-within:border-amber-700",
  emerald: "hover:border-emerald-300 focus-within:border-emerald-300 dark:hover:border-emerald-700 dark:focus-within:border-emerald-700",
  primary: "hover:border-blue-300 focus-within:border-blue-300 dark:hover:border-blue-700 dark:focus-within:border-blue-700",
  pink: "hover:border-pink-300 focus-within:border-pink-300 dark:hover:border-pink-700 dark:focus-within:border-pink-700",
  neutral: "hover:border-muted-foreground/40 focus-within:border-muted-foreground/40",
};

/** The card's wash: its tone in the top-left corner, fading to the surface. */
const WASH: Record<StatTone, string> = {
  violet: "from-violet-100/70 dark:from-violet-950/40",
  amber: "from-amber-100/60 dark:from-amber-950/30",
  emerald: "from-emerald-100/60 dark:from-emerald-950/30",
  primary: "from-blue-100/60 dark:from-blue-950/30",
  pink: "from-pink-100/60 dark:from-pink-950/30",
  neutral: "from-muted/70 dark:from-muted/40",
};

/** Fill of the optional progress bar. */
const BAR: Record<StatTone, string> = {
  violet: "bg-violet-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  primary: "bg-blue-500",
  pink: "bg-pink-500",
  neutral: "bg-muted-foreground",
};

export interface StatCardProps {
  title: string;
  value: number | string;
  hint: string;
  /** Drawn in a glass tile in the card's left column. */
  icon?: LucideIcon;
  tone: StatTone;
  /**
   * Tighter padding and a smaller figure below sm, so a two-up phone row keeps
   * its titles readable.
   */
  denseOnPhone?: boolean;
  /**
   * Where clicking the card goes. `label` is read to screen readers as the
   * link's name; it is not shown. Omit for a read-only figure — the roster's
   * cards describe the list directly beneath them.
   */
  action?: { label: string; href: string };
  /** Whole-card target for a card with no `action`. */
  href?: string;
  /**
   * 0–100. Draws a bar under the hint with the percentage beside it (the End
   * of Terms "Grades Saved" card).
   */
  progress?: number;
  /**
   * The progressbar's `aria-label`, when `progress` is set. Falls back to
   * `title` so every caller that predates this prop is unchanged. Pass the
   * specific figure/period a sighted reader sees next to the bar (e.g. "6 of
   * 10 learners assessed in October") rather than letting a screen reader
   * hear only the card's static title.
   */
  progressLabel?: string;
  /**
   * Extra classes for the figure. For a value that can run long (a rubric
   * label rather than a number), pass a smaller size so it wraps instead of
   * overflowing the card.
   */
  valueClassName?: string;
}

export function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  tone,
  denseOnPhone = false,
  action,
  href,
  progress,
  progressLabel,
  valueClassName,
}: StatCardProps) {
  const target = action?.href ?? href;
  const clickable = Boolean(target);
  return (
    <Surface
      as="section"
      data-stat-card=""
      className={cn(
        "group @container/stat relative flex flex-col overflow-hidden rounded-lg sm:p-5",
        // Frosted glass: a translucent card surface with its tone washed into
        // the top-left corner, over a backdrop blur.
        "bg-card/55 bg-gradient-to-br via-card/55 via-60% to-card/55 backdrop-blur-xl dark:bg-card/45 dark:via-card/45 dark:to-card/45",
        "border-white/60 dark:border-white/10",
        "shadow-[0_8px_24px_-12px_rgb(15_23_42/0.18)] dark:shadow-[0_8px_24px_-12px_rgb(0_0_0/0.5)]",
        denseOnPhone ? "p-3" : "p-4",
        WASH[tone],
        // Every card — clickable or read-only — lifts, enlarges slightly,
        // deepens its shadow and rings in its tone on hover / focus.
        "transition-[transform,box-shadow,border-color,opacity] duration-200 ease-out",
        "hover:z-20 hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-[0_16px_32px_-12px_rgb(15_23_42/0.25)] dark:hover:shadow-[0_16px_32px_-12px_rgb(0_0_0/0.6)]",
        "focus-within:z-20 focus-within:-translate-y-0.5 focus-within:scale-[1.02] focus-within:shadow-[0_16px_32px_-12px_rgb(15_23_42/0.25)] dark:focus-within:shadow-[0_16px_32px_-12px_rgb(0_0_0/0.6)]",
        "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:hover:scale-100",
        HOVER_RING[tone],
        // Only a card that goes somewhere looks pressable.
        clickable &&
          "cursor-pointer active:translate-y-0 active:scale-[0.98] active:shadow-[0_2px_6px_-2px_rgb(15_23_42/0.15)] motion-reduce:active:scale-100"
      )}
    >
      {clickable ? (
        <ArrowUpRight
          aria-hidden
          className={cn(
            "absolute right-3 top-3 size-4 opacity-0 transition-all duration-200",
            "-translate-x-1 translate-y-1 group-hover:translate-x-0 group-hover:translate-y-0 group-hover:opacity-100",
            "group-focus-within:translate-x-0 group-focus-within:translate-y-0 group-focus-within:opacity-100",
            LINK[tone]
          )}
        />
      ) : null}

      {/* The card decides its layout by its own width (container query), not
          the screen: in a narrow card (two-up on a phone, three-up on a
          tablet) the icon sits above the figure so the number and title keep
          the full width instead of breaking mid-word. From 14rem (measured inside
          the padding, so a 17rem STAT_GRID card qualifies) the icon
          moves beside the text as a square tile; from 18rem it is full size. */}
      <div className="relative flex flex-col items-start gap-2 @[14rem]/stat:flex-row @[14rem]/stat:items-center @[14rem]/stat:gap-4">
        {Icon ? (
          <span
            aria-hidden
            className={cn(
              "flex size-11 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-105 motion-reduce:group-hover:scale-100",
              denseOnPhone ? "@[14rem]/stat:size-[3.75rem]" : "@[14rem]/stat:size-[4.25rem]",
              "@[18rem]/stat:size-20",
              TILE_GLASS,
              TILE[tone]
            )}
          >
            <Icon className="size-5 @[14rem]/stat:size-7 @[18rem]/stat:size-8" />
          </span>
        ) : null}
        <div className="w-full min-w-0 flex-1 pr-3">
          <p
            className={cn(
              "break-words font-extrabold tabular-nums tracking-tight text-foreground sm:text-3xl",
              denseOnPhone ? "text-xl" : "text-2xl",
              valueClassName
            )}
          >
            {value}
          </p>
          {/* One line only, like the hint: a long title ends in "…" (the full
              text stays in the tooltip) so every card in a row keeps the same
              height. */}
          <h2
            title={title}
            className={cn(
              "truncate font-semibold text-foreground sm:text-base",
              denseOnPhone ? "text-xs" : "text-sm"
            )}
          >
            {title}
          </h2>
          {/* One line only: an overflowing hint ends in "…". */}
          <p className="truncate text-xs text-muted-foreground sm:text-sm">
            {hint}
          </p>
        </div>
      </div>

      {progress !== undefined ? (
        <div className="relative mt-3 flex items-center gap-3">
          <div
            role="progressbar"
            aria-label={progressLabel ?? title}
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn("h-full rounded-full transition-[width]", BAR[tone])}
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
            {progress}%
          </span>
        </div>
      ) : null}

      {target ? (
        <PrefetchLink
          href={target}
          prefetch
          aria-label={action?.label ?? title}
          data-stat-link=""
          className="absolute inset-0 z-10 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        />
      ) : null}
    </Surface>
  );
}

/**
 * The grid every stat-card row uses outside the dashboard's own 2-up row.
 * Two per row on phones (as the dashboard does); from sm, as many per row as
 * fit at 17rem or wider, so every card is wide enough for the dashboard
 * layout — the large icon tile beside the figure — instead of the narrow
 * stacked one.
 */
export const STAT_GRID =
  "grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(17rem,1fr))] sm:gap-4";

export function StatCardRow({ children }: { children: React.ReactNode }) {
  // xl (1280–1535) keeps the 20rem rail beside this column, which leaves too
  // little room for four cards without crushing titles and CTA pills — stay
  // 2-up through xl and only go 4-up once 2xl gives the row its own width.
  return (
    // The sibling blur on hover lives in globals.css ([data-stat-card]), so
    // it also works in pages that lay cards out in their own grids.
    <div className="grid grid-cols-2 gap-3 sm:gap-4 2xl:grid-cols-4">{children}</div>
  );
}
