import { PrefetchLink } from "@/components/nav/prefetch-link";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { ArrowUpRight, type LucideIcon } from "lucide-react";

/**
 * The shared stat card: a tinted icon tile in a left column; the figure, then
 * the title, then its hint stacked in a right column.
 *
 * A card with a destination is itself the link — there is no separate button.
 * It lifts, deepens its shadow, rings in its tone and shows an arrow on hover
 * or keyboard focus, and presses in on click, so it reads as clickable.
 *
 * Each card keeps a faint wash of its tone and optional decorative art in the
 * bottom-right corner, pale enough that the figure stays the loudest thing.
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

/** Decorative art drawn behind the card's right side. Purely visual. */
export type StatDecor = "wave" | "bars" | "sprout" | "clock" | "people";

const TILE: Record<StatTone, string> = {
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200",
  emerald:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200",
  primary: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200",
  pink: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-200",
  neutral: "bg-muted text-muted-foreground",
};

/** Hover arrow colour. */
const LINK: Record<StatTone, string> = {
  violet: "text-violet-700 dark:text-violet-300",
  amber: "text-amber-700 dark:text-amber-400",
  emerald: "text-emerald-700 dark:text-emerald-400",
  primary: "text-blue-700 dark:text-blue-400",
  pink: "text-pink-700 dark:text-pink-400",
  neutral: "text-muted-foreground",
};

/** Border colour a clickable card rings in on hover / focus. */
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

/** Colour the decor's `currentColor` resolves to. */
const DECOR_COLOR: Record<StatTone, string> = {
  violet: "text-violet-400 dark:text-violet-500",
  amber: "text-amber-300 dark:text-amber-600",
  emerald: "text-emerald-300 dark:text-emerald-600",
  primary: "text-blue-400 dark:text-blue-400",
  pink: "text-pink-300 dark:text-pink-500",
  neutral: "text-muted-foreground/40",
};

function Decor({
  kind,
  tone,
  compact = false,
}: {
  kind: StatDecor;
  tone: StatTone;
  /** Smaller below lg, for the narrow inline cards. */
  compact?: boolean;
}) {
  const id = `stat-decor-${kind}-${tone}`;
  const base = cn("pointer-events-none absolute", DECOR_COLOR[tone]);

  if (kind === "clock") {
    return (
      <svg
        aria-hidden
        viewBox="0 0 40 40"
        className={cn(base, "-bottom-2 -right-2 size-16 opacity-40 sm:size-20")}
      >
        <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M20 11v10l6 4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // The art sits in the bottom-right corner, behind the text column.
  const box = cn(
    "bottom-0 right-1 opacity-60",
    compact ? "h-16 w-24 sm:h-20 sm:w-28" : "h-20 w-28 sm:h-24 sm:w-36"
  );

  if (kind === "wave") {
    return (
      <svg aria-hidden viewBox="0 0 120 80" preserveAspectRatio="none" className={cn(base, box)}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.55" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0 80 C 30 78, 45 62, 65 48 S 95 8, 108 12 C 116 14, 120 24, 120 36 V 80 Z"
          fill={`url(#${id})`}
        />
      </svg>
    );
  }

  if (kind === "bars") {
    return (
      <svg aria-hidden viewBox="0 0 120 80" className={cn(base, box)}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.7" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect x="58" y="36" width="14" height="44" rx="7" fill={`url(#${id})`} />
        <rect x="80" y="20" width="14" height="60" rx="7" fill={`url(#${id})`} />
        <rect x="102" y="2" width="14" height="78" rx="7" fill={`url(#${id})`} />
      </svg>
    );
  }

  if (kind === "people") {
    return (
      <svg aria-hidden viewBox="0 0 120 80" className={cn(base, box, "opacity-45")}>
        <circle cx="62" cy="36" r="11" fill="currentColor" />
        <path d="M40 80 C 40 60, 50 52, 62 52 S 84 60, 84 80 Z" fill="currentColor" />
        <circle cx="96" cy="30" r="13" fill="currentColor" opacity="0.8" />
        <path d="M70 80 C 70 56, 82 48, 96 48 S 122 56, 122 80 Z" fill="currentColor" opacity="0.8" />
      </svg>
    );
  }

  // sprout
  return (
    <svg aria-hidden viewBox="0 0 120 80" className={cn(base, box, "opacity-50")}>
      <circle cx="84" cy="10" r="8" fill="currentColor" />
      <path d="M84 30 V 80" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
      <path d="M82 50 C 64 50, 52 38, 50 22 C 68 22, 82 32, 82 50 Z" fill="currentColor" />
      <path d="M86 50 C 104 50, 116 38, 118 22 C 100 22, 86 32, 86 50 Z" fill="currentColor" />
    </svg>
  );
}

export interface StatCardProps {
  title: string;
  value: number | string;
  hint: string;
  /** Drawn in a tinted tile in the card's left column. */
  icon?: LucideIcon;
  tone: StatTone;
  /** Optional decorative art in the card's bottom-right corner. */
  decor?: StatDecor;
  /** Smaller art below lg, for narrow cards. */
  inlineOnPhone?: boolean;
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
  decor,
  inlineOnPhone = false,
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
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg sm:p-5",
        // Glass: a translucent tinted pane that blurs whatever sits behind it
        // (the hero art, the page background), with a bright hairline edge
        // and a top highlight so it reads as a sheet of frosted glass.
        "bg-white/45 bg-gradient-to-br via-white/25 via-60% to-white/10 dark:bg-card/45 dark:via-card/25 dark:to-card/10",
        "backdrop-blur-xl backdrop-saturate-150",
        "border-white/70 dark:border-white/10",
        "shadow-[inset_0_1px_0_0_rgb(255_255_255/0.7),0_8px_24px_-12px_rgb(15_23_42/0.18)] dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.08),0_8px_24px_-12px_rgb(0_0_0/0.5)]",
        denseOnPhone ? "p-3" : "p-4",
        WASH[tone],
        // Read-only cards still ease into the row's sibling blur.
        !clickable && "transition-[filter,opacity] duration-200 ease-out",
        clickable &&
          cn(
            "cursor-pointer transition-[transform,box-shadow,border-color,filter,opacity] duration-200 ease-out",
            "hover:z-20 hover:-translate-y-0.5 hover:scale-[1.02] hover:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.7),0_16px_32px_-12px_rgb(15_23_42/0.25)] dark:hover:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.08),0_16px_32px_-12px_rgb(0_0_0/0.6)]",
            "focus-within:z-20 focus-within:-translate-y-0.5 focus-within:scale-[1.02] focus-within:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.7),0_16px_32px_-12px_rgb(15_23_42/0.25)] dark:focus-within:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.08),0_16px_32px_-12px_rgb(0_0_0/0.6)]",
            "active:translate-y-0 active:scale-[0.98] active:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.7),0_2px_6px_-2px_rgb(15_23_42/0.15)]",
            "motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:hover:scale-100 motion-reduce:active:scale-100",
            HOVER_RING[tone]
          )
      )}
    >
      {decor ? <Decor kind={decor} tone={tone} compact={inlineOnPhone} /> : null}

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

      {/* The tile is a fixed square equal to the text column's height: figure
          + one title line + one hint line, all at their default line heights
          (sm+: 36 + 24 + 20 = 80px; phone: 32 + 20 + 16 = 68; dense phone:
          28 + 16 + 16 = 60). If a long title wraps, the tile stays square and
          centres on the column. */}
      <div className={cn("relative flex items-center", denseOnPhone ? "gap-2.5 sm:gap-4" : "gap-4")}>
        {Icon ? (
          <span
            aria-hidden
            className={cn(
              "flex shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-105 sm:size-20 motion-reduce:group-hover:scale-100",
              denseOnPhone ? "size-[3.75rem]" : "size-[4.25rem]",
              TILE[tone]
            )}
          >
            <Icon className={denseOnPhone ? "size-6 sm:size-8" : "size-7 sm:size-8"} />
          </span>
        ) : null}
        <div className="min-w-0 flex-1 pr-3">
          <p
            className={cn(
              "break-words font-extrabold tabular-nums tracking-tight text-foreground sm:text-3xl",
              denseOnPhone ? "text-xl" : "text-2xl",
              valueClassName
            )}
          >
            {value}
          </p>
          <h2
            className={cn(
              "break-words font-semibold text-foreground sm:text-base",
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

export function StatCardRow({ children }: { children: React.ReactNode }) {
  // xl (1280–1535) keeps the 20rem rail beside this column, which leaves too
  // little room for four cards without crushing titles and CTA pills — stay
  // 2-up through xl and only go 4-up once 2xl gives the row its own width.
  return (
    // While a clickable card is hovered, its siblings soften (slight blur and
    // fade) so the hovered card stands out. Keyed on the card's link, so a row
    // of read-only cards never blurs.
    <div
      className={cn(
        "grid grid-cols-2 gap-3 sm:gap-4 2xl:grid-cols-4",
        "[&:has([data-stat-link]:hover)>*:not(:hover)]:opacity-90 [&:has([data-stat-link]:hover)>*:not(:hover)]:blur-[0.75px]",
        "motion-reduce:[&:has([data-stat-link]:hover)>*:not(:hover)]:blur-none"
      )}
    >
      {children}
    </div>
  );
}
