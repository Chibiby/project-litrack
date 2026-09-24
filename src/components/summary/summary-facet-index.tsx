import Link from "next/link";
import {
  BookOpen,
  BookOpenCheck,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  ShieldAlert,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SUMMARY_FACET_LIST } from "@/lib/summary/facet-meta";
import type { SummaryFacetId } from "@/lib/summary/types";

export const SUMMARY_FACET_ICON: Record<SummaryFacetId, LucideIcon> = {
  learners: Users,
  "reading-behavior": BookOpenCheck,
  "end-of-term": ClipboardList,
  attendance: CalendarDays,
  "reading-levels": BookOpen,
  compliance: ShieldAlert,
  profiling: UserRound,
};

// Violet is the ARAL accent: only the facets whose population is ARAL learners.
const TONE: Record<SummaryFacetId, string> = {
  learners: "bg-primary/10 text-primary",
  "reading-behavior": "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  "end-of-term": "bg-primary/10 text-primary",
  attendance: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  "reading-levels": "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  compliance: "bg-secondary/25 text-secondary-foreground",
  profiling: "bg-primary/10 text-primary",
};

/** One card per summary facet, linking to `${basePath}/<facet>`. */
export function SummaryFacetIndex({ basePath, query }: { basePath: string; query?: string }) {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {SUMMARY_FACET_LIST.map((facet) => {
        const Icon = SUMMARY_FACET_ICON[facet.id];
        return (
          <li key={facet.id} className="min-w-0">
            <Link
              href={`${basePath}/${facet.id}${query ? `?${query}` : ""}`}
              prefetch={true}
              className="group flex h-full items-start gap-3 rounded-xl border border-border/80 bg-card p-4 shadow-card transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full",
                  TONE[facet.id]
                )}
              >
                <Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold leading-tight text-foreground">{facet.label}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{facet.description}</span>
              </span>
              <ChevronRight
                aria-hidden
                className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** Links between facets on a facet page, keeping the chosen scope. */
export function SummaryFacetSwitcher({
  basePath,
  current,
  scopeQuery,
}: {
  basePath: string;
  current: SummaryFacetId;
  scopeQuery: string;
}) {
  return (
    <nav aria-label="Summaries" className="min-w-0">
      <ul className="flex flex-wrap gap-2">
        {SUMMARY_FACET_LIST.map((facet) => {
          const active = facet.id === current;
          return (
            <li key={facet.id}>
              <Link
                href={`${basePath}/${facet.id}${scopeQuery ? `?${scopeQuery}` : ""}`}
                prefetch={true}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-10 items-center rounded-full border px-3.5 text-sm font-medium transition-colors lg:min-h-9",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {facet.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
