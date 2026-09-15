import { PrefetchLink } from "@/components/nav/prefetch-link";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { ArrowRight, ChevronRight, type LucideIcon } from "lucide-react";

/**
 * The dashboard's four stat cards, laid out to the approved design: a tinted
 * icon tile and title on the top row, the figure beneath it, a one-line hint,
 * then a coloured link into the page that acts on it.
 *
 * Colour is confined to the icon tile and the link — the card itself stays on
 * the neutral surface every other panel uses, so four cards in a row read as
 * one instrument rather than four competing blocks.
 */

export type StatTone = "violet" | "amber" | "emerald" | "primary";

const TILE: Record<StatTone, string> = {
  violet: "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200",
  emerald:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200",
  primary: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200",
};

const LINK: Record<StatTone, string> = {
  violet: "text-violet-700 dark:text-violet-300",
  amber: "text-amber-700 dark:text-amber-400",
  emerald: "text-emerald-700 dark:text-emerald-400",
  primary: "text-blue-700 dark:text-blue-400",
};

const PILL: Record<StatTone, string> = {
  violet: "bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-900/40 dark:text-violet-200 dark:hover:bg-violet-900/60",
  amber: "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-900/50",
  emerald: "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:hover:bg-emerald-900/50",
  primary: "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-200 dark:hover:bg-blue-900/50",
};

export interface StatCardProps {
  title: string;
  value: number | string;
  hint: string;
  icon: LucideIcon;
  tone: StatTone;
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
  action,
  href,
}: StatCardProps) {
  // Phones show no pill (image 4): the whole card is the link, marked by a
  // chevron beside the title. Desktop keeps the labelled pill (image 3).
  const target = action?.href ?? href;
  return (
    <Surface as="section" className="relative flex flex-col overflow-hidden rounded-2xl p-4 sm:p-5">
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
        <h2 className="min-w-0 flex-1 text-sm font-semibold text-foreground sm:text-base">
          {title}
        </h2>
        {target ? (
          <ChevronRight aria-hidden className={cn("size-4 shrink-0 lg:hidden", LINK[tone])} />
        ) : null}
      </div>

      <p className="mt-3 text-3xl font-extrabold tabular-nums tracking-tight text-foreground">
        {value}
      </p>
      <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>

      {action ? (
        <PrefetchLink
          href={action.href}
          prefetch
          className={cn(
            "mt-4 hidden w-fit items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card lg:inline-flex",
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
