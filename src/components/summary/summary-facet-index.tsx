import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  BookOpenCheck,
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Flag,
  GraduationCap,
  ShieldAlert,
  UserCheck,
  UserRound,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
  bosy: Flag,
  mosy: ClipboardCheck,
  "aral-teachers": UserCheck,
  advisory: UsersRound,
};

const PRIMARY_TILE = "icon-glass text-blue-700 dark:text-blue-200";
const ARAL_TILE = "icon-glass text-violet-700 dark:text-violet-200";

// Same tile palette as the dashboard stat cards. Violet is the ARAL accent:
// only the facets whose population is ARAL learners.
export const SUMMARY_FACET_TILE: Record<SummaryFacetId, string> = {
  learners: PRIMARY_TILE,
  "reading-behavior": ARAL_TILE,
  "end-of-term": PRIMARY_TILE,
  attendance: ARAL_TILE,
  "reading-levels": ARAL_TILE,
  compliance: "icon-glass text-amber-700 dark:text-amber-200",
  profiling: "icon-glass text-emerald-700 dark:text-emerald-200",
  aral: ARAL_TILE,
  bosy: ARAL_TILE,
  mosy: ARAL_TILE,
  "aral-teachers": ARAL_TILE,
  advisory: PRIMARY_TILE,
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
              className={cn(
                "group flex h-full items-start gap-3 rounded-lg border p-4 sm:p-5",
                // Frosted glass, the stat card recipe: a translucent surface over a blur.
                "border-white/60 bg-card/55 backdrop-blur-xl dark:border-white/10 dark:bg-card/45",
                "shadow-[0_8px_24px_-12px_rgb(15_23_42/0.18)] dark:shadow-[0_8px_24px_-12px_rgb(0_0_0/0.5)]",
                "transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_32px_-12px_rgb(15_23_42/0.25)] dark:hover:shadow-[0_16px_32px_-12px_rgb(0_0_0/0.6)] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-md sm:size-11",
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
 * The way back from a facet page to the list of summaries (the index of
 * cards above). One button, not a strip of every facet: picking another
 * summary happens on the index.
 */
export function SummaryBackLink({ basePath }: { basePath: string }) {
  return (
    <Button asChild variant="outline" size="sm" className="w-fit">
      <Link href={basePath} prefetch={true}>
        <ArrowLeft aria-hidden className="size-4" />
        Back to summaries
      </Link>
    </Button>
  );
}
