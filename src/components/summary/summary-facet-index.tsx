import Link from "next/link";
import {
  BookOpen,
  BookOpenCheck,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  GraduationCap,
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
  aral: GraduationCap,
};

const PRIMARY_TILE = "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200";
const ARAL_TILE = "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200";

// Same tile palette as the dashboard stat cards. Violet is the ARAL accent:
// only the facets whose population is ARAL learners.
export const SUMMARY_FACET_TILE: Record<SummaryFacetId, string> = {
  learners: PRIMARY_TILE,
  "reading-behavior": ARAL_TILE,
  "end-of-term": PRIMARY_TILE,
  attendance: ARAL_TILE,
  "reading-levels": ARAL_TILE,
  compliance: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200",
  profiling: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200",
  aral: ARAL_TILE,
};

/** One card per summary facet, linking to `${basePath}/<facet>`. */
export function SummaryFacetIndex({
  basePath,
  query,
  gridColsXl = 3,
}: {
  basePath: string;
  query?: string;
  /** Columns at `xl`. Callers that share the viewport with a fixed-width
   * aside (e.g. the district overview's left column) need fewer than the
   * default full-width 3. Always 3+ from `2xl` up. */
  gridColsXl?: 2 | 3;
}) {
  return (
    <ul
      className={cn(
        "grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 2xl:grid-cols-3",
        gridColsXl === 2 ? "xl:grid-cols-2" : "xl:grid-cols-3"
      )}
    >
      {SUMMARY_FACET_LIST.map((facet) => {
        const Icon = SUMMARY_FACET_ICON[facet.id];
        return (
          <li key={facet.id} className="min-w-0">
            <Link
              href={`${basePath}/${facet.id}${query ? `?${query}` : ""}`}
              prefetch={true}
              className="group flex h-full items-start gap-3 rounded-2xl border border-border/80 bg-card p-4 shadow-card transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-xl sm:size-11",
                  SUMMARY_FACET_TILE[facet.id]
                )}
              >
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold leading-tight text-foreground">{facet.label}</span>
                <span className="mt-1 block text-sm text-muted-foreground">{facet.description}</span>
              </span>
              <ChevronRight
                aria-hidden
                className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Links between facets on a facet page, keeping the chosen scope. Drawn like
 * the School Head workspace tab bar (`TabNav`): an underlined strip that
 * scrolls sideways inside itself on a phone instead of wrapping into rows.
 */
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
    <nav aria-label="Summaries" className="min-w-0 overflow-x-auto">
      <ul className="flex min-w-max items-center gap-1 border-b border-border/70">
        {SUMMARY_FACET_LIST.map((facet) => {
          const active = facet.id === current;
          return (
            <li key={facet.id}>
              <Link
                href={`${basePath}/${facet.id}${scopeQuery ? `?${scopeQuery}` : ""}`}
                prefetch={true}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // -mb-px lifts the 2px active underline over the ul's 1px rule.
                  "-mb-px flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium transition-colors sm:min-h-10 lg:min-h-9",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
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
