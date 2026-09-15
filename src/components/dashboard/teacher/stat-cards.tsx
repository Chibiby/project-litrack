import { PrefetchLink } from "@/components/nav/prefetch-link";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { ArrowRight, ChevronRight, type LucideIcon } from "lucide-react";

/**
 * The dashboard's four stat cards, laid out to the approved design: a tinted
 * icon tile and title on the top row, the figure beneath it, a one-line hint,
 * then a coloured link into the page that acts on it.
 *
 * v2: each card carries a faint wash of its tone and an optional line of
 * decorative art on the right (mockup images 3 and 4). Both stay pale enough
 * that the figure is still the loudest thing on the card.
 */

export type StatTone = "violet" | "amber" | "emerald" | "primary" | "pink";

/** Decorative art drawn behind the card's right side. Purely visual. */
export type StatDecor = "wave" | "bars" | "sprout" | "clock" | "people";

const TILE: Record<StatTone, string> = {
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200",
  emerald:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200",
  primary: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200",
  pink: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-200",
};

const LINK: Record<StatTone, string> = {
  violet: "text-violet-700 dark:text-violet-300",
  amber: "text-amber-700 dark:text-amber-400",
  emerald: "text-emerald-700 dark:text-emerald-400",
  primary: "text-blue-700 dark:text-blue-400",
  pink: "text-pink-700 dark:text-pink-400",
};

const PILL: Record<StatTone, string> = {
  violet: "bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-900/40 dark:text-violet-200 dark:hover:bg-violet-900/60",
  amber: "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50",
  emerald: "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:hover:bg-emerald-900/50",
  primary: "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:hover:bg-blue-900/50",
  pink: "bg-pink-100 text-pink-800 hover:bg-pink-200 dark:bg-pink-900/30 dark:text-pink-200 dark:hover:bg-pink-900/50",
};

/** The card's wash: its tone in the top-left corner, fading to the surface. */
const WASH: Record<StatTone, string> = {
  violet: "from-violet-100/70 dark:from-violet-950/40",
  amber: "from-amber-100/60 dark:from-amber-950/30",
  emerald: "from-emerald-100/60 dark:from-emerald-950/30",
  primary: "from-blue-100/60 dark:from-blue-950/30",
  pink: "from-pink-100/60 dark:from-pink-950/30",
};

/** Colour the decor's `currentColor` resolves to. */
const DECOR_COLOR: Record<StatTone, string> = {
  violet: "text-violet-400 dark:text-violet-500",
  amber: "text-amber-300 dark:text-amber-600",
  emerald: "text-emerald-300 dark:text-emerald-600",
  primary: "text-blue-400 dark:text-blue-400",
  pink: "text-pink-300 dark:text-pink-500",
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
        className={cn(base, "bottom-4 right-4 size-8 opacity-80 sm:right-5 sm:size-9 lg:bottom-auto lg:top-[4.75rem]")}
      >
        <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M20 11v10l6 4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // Phones have no pill, so the art sits at the card's foot, clear of the
  // title; desktop lifts it beside the figure, above the pill.
  const box = cn(
    "bottom-2 right-2 lg:bottom-auto lg:right-4 lg:top-14 lg:h-20 lg:w-28",
    compact ? "h-9 w-12 opacity-70 sm:h-14 sm:w-20" : "h-14 w-20 sm:h-16 sm:w-24"
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
  icon: LucideIcon;
  tone: StatTone;
  /** Optional decorative art on the right of the card. */
  decor?: StatDecor;
  /**
   * Below lg, put the icon tile to the left of the title, figure and hint
   * instead of above them (the v2 Learners mockup, image 2).
   */
  inlineOnPhone?: boolean;
  /**
   * Omit for a read-only figure. The roster's four cards describe the list
   * directly beneath them, so a link out of the card would only point back at
   * the page the reader is already on.
   */
  action?: { label: string; href: string };
  /**
   * Phone-only whole-card target for a card with no `action`. Never set on a
   * card that must stay read-only (Pending Profiles).
   */
  href?: string;
}

export function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  tone,
  decor,
  inlineOnPhone = false,
  action,
  href,
}: StatCardProps) {
  // Phones show no pill (image 4): the whole card is the link, marked by a
  // chevron beside the title. Desktop keeps the labelled pill (image 3).
  const target = action?.href ?? href;
  return (
    <Surface
      as="section"
      className={cn(
        "relative flex flex-col overflow-hidden rounded-2xl bg-gradient-to-br via-card via-60% to-card p-4 sm:p-5",
        WASH[tone]
      )}
    >
      {decor ? <Decor kind={decor} tone={tone} compact={inlineOnPhone} /> : null}

      {inlineOnPhone ? (
        <div className="relative flex items-start gap-3 lg:flex-col lg:gap-0">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-xl sm:size-11",
                TILE[tone]
              )}
            >
              <Icon className="size-5" />
            </span>
            <h2 className="hidden min-w-0 flex-1 text-base font-semibold text-foreground lg:block">
              {title}
            </h2>
          </div>
          <div className="min-w-0">
            <h2 className="text-[13px] font-semibold leading-snug text-foreground sm:text-sm lg:hidden">
              {title}
            </h2>
            <p className="mt-1 text-2xl font-extrabold tabular-nums tracking-tight text-foreground sm:text-3xl lg:mt-3">
              {value}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground sm:text-sm">{hint}</p>
          </div>
        </div>
      ) : (
        <>
        <div className="relative flex items-center gap-3">
          <span
            aria-hidden
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl sm:size-11",
              TILE[tone]
            )}
          >
            <Icon className="size-5" />
          </span>
          <h2 className="min-w-0 flex-1 text-sm font-semibold text-foreground sm:text-base">
            {title}
          </h2>
          {target ? (
            <ChevronRight aria-hidden className={cn("size-4 shrink-0 lg:hidden", LINK[tone])} />
          ) : null}
        </div>
  
        <p className="relative mt-3 text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
          {value}
        </p>
        <p className="relative mt-0.5 text-sm text-muted-foreground">{hint}</p>
  
        </>
      )}

      {action ? (
        <PrefetchLink
          href={action.href}
          prefetch
          className={cn(
            "relative mt-4 hidden w-fit items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card lg:inline-flex",
            PILL[tone]
          )}
        >
          {action.label}
          <ArrowRight aria-hidden className="size-4" />
        </PrefetchLink>
      ) : null}

      {target ? (
        <PrefetchLink
          href={target}
          prefetch
          aria-label={action?.label ?? title}
          className="absolute inset-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
        />
      ) : null}
    </Surface>
  );
}

export function StatCardRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">{children}</div>
  );
}
