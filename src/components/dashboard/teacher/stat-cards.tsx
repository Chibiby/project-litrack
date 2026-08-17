import { PrefetchLink } from "@/components/nav/prefetch-link";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { ArrowRight, type LucideIcon } from "lucide-react";

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

export interface StatCardProps {
  title: string;
  value: number | string;
  hint: string;
  icon: LucideIcon;
  tone: StatTone;
  action: { label: string; href: string };
}

export function StatCard({
  title,
  value,
  hint,
  icon: Icon,
  tone,
  action,
}: StatCardProps) {
  return (
    <Surface as="section" className="flex flex-col p-5">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl",
            TILE[tone]
          )}
        >
          <Icon className="size-5" />
        </span>
        <h2 className="min-w-0 text-sm font-medium text-muted-foreground">
          {title}
        </h2>
      </div>

      <p className="mt-4 text-3xl font-bold tabular-nums tracking-tight text-foreground">
        {value}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>

      <PrefetchLink
        href={action.href}
        prefetch
        className={cn(
          "mt-4 inline-flex items-center gap-1.5 rounded-md text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
          LINK[tone]
        )}
      >
        {action.label}
        <ArrowRight aria-hidden className="size-4" />
      </PrefetchLink>
    </Surface>
  );
}

export function StatCardRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
  );
}
