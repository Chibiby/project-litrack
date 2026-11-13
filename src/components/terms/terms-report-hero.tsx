import Link from "next/link";
import { Lock } from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";
import { TermsAdvisoryHeroControl } from "@/components/terms/terms-advisory-hero-control";
import { cn } from "@/lib/utils";
import { sheetHref, type SheetUrlState } from "@/lib/terms/sheet-view";
import type { TermPeriodValue } from "@/lib/terms/windows";

export type TermTab = {
  term: TermPeriodValue;
  label: string;
  rangeLabel: string;
  locked: boolean;
};

/** "September - November" → "Sep - Nov", for the phone-width term tabs. */
function shortRangeLabel(rangeLabel: string): string {
  return rangeLabel
    .split(" - ")
    .map((month) => month.slice(0, 3))
    .join(" - ");
}

/**
 * The v2 End of Terms banner, to the owner's mockup: the page label, the
 * title with its grade, the term and school year, and the three term tabs,
 * over the learner banner art.
 *
 * The term tabs are links: the term picks which scores load, so it lives in the
 * URL like every other filter. Switching term keeps the page index, since the
 * term changes the scores shown, not which learners.
 */
export function TermsReportHero({
  title,
  subtitle,
  basePath,
  state,
  page,
  terms,
  advisories,
  kinderSectionIds,
  kinderBasePath,
}: {
  title: string;
  subtitle: string;
  basePath: string;
  state: SheetUrlState;
  page: number;
  terms: TermTab[];
  /** The teacher's advisories. Empty for a Super Admin, who advises none. */
  advisories: readonly { id: string; label: string }[];
  /** Section ids among `advisories` that are Kindergarten (owner decision — see `TermsAdvisoryHeroControl`). */
  kinderSectionIds?: readonly string[];
  kinderBasePath?: string;
}) {
  return (
    <PageHero
      bannerSrc="/brand/banner-learner.webp"
      className="h-auto"
      topRight={
        <TermsAdvisoryHeroControl
          basePath={basePath}
          state={state}
          advisories={advisories}
          kinderSectionIds={kinderSectionIds}
          kinderBasePath={kinderBasePath}
        />
      }
      // Phones: the advisory picker takes the top-right corner and the term
      // tabs the bottom, so there is no room left for the art; it is hidden
      // and the subtitle uses the full width. Tablets: the term tabs make the band
      // tall, so the art keeps a fixed height pinned to the top instead of
      // scaling up behind the title.
      artClassName="max-sm:hidden sm:max-lg:!h-[10.5rem] sm:right-[calc(50%-300px)] lg:right-[min(0px,calc(100%-1291px))]"
      phoneMaskClassName="max-sm:[&>img]:[mask-image:linear-gradient(to_right,transparent_45%,black_56%)] sm:max-lg:[&>img]:[mask-image:linear-gradient(to_right,transparent_30%,black_45%,black_88%,transparent),linear-gradient(to_bottom,black_70%,transparent)] sm:max-lg:[&>img]:[mask-composite:intersect] sm:max-lg:[&>img]:!bottom-auto sm:max-lg:[&>img]:top-0"
      headClassName="max-lg:hidden"
      contentClassName="justify-start gap-0 px-4 py-4 sm:px-5 sm:py-6 lg:min-h-[17rem] lg:justify-center lg:px-8"
    >
      <div className="relative z-10">
        {/* Half the band at most, so the title wraps before it reaches the art's
            handwriting; balanced so "Grade 3" never sits alone on a line. */}
        <h1 className="mt-1.5 max-w-[60%] text-balance text-[1.1875rem] font-extrabold leading-tight tracking-tight text-slate-950 dark:text-white sm:mt-2 sm:max-w-[42%] sm:text-3xl lg:max-w-[46%] lg:text-4xl">
          {title}
        </h1>
        <p className="mt-1 text-xs leading-snug text-slate-600 dark:text-slate-300 max-sm:line-clamp-2 sm:max-w-[48%] sm:text-sm lg:max-w-[46%] lg:text-lg">
          {subtitle}
        </p>
      </div>

      <nav
        aria-label="Terms"
        className="mt-3 grid max-w-[36rem] grid-cols-3 gap-1.5 sm:mt-4 sm:gap-3"
      >
        {terms.map((tab) => {
          const active = tab.term === state.term;
          return (
            <Link
              key={tab.term}
              href={sheetHref(basePath, { ...state, term: tab.term }, page)}
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-w-0 flex-col rounded-lg border px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4 sm:py-2",
                active
                  ? "border-transparent bg-gradient-to-r from-aral-600 to-aral-500 text-white shadow-sm shadow-aral-500/30"
                  : "border-border bg-card/90 text-foreground hover:bg-card"
              )}
            >
              <span className="flex items-center gap-1 truncate text-xs font-semibold sm:gap-1.5 sm:text-base">
                {tab.label}
                {tab.locked ? <Lock className="size-3.5 shrink-0" aria-label="Locked" /> : null}
              </span>
              <span
                className={cn(
                  "truncate text-xs sm:text-sm",
                  active ? "text-white/85" : "text-muted-foreground"
                )}
              >
                {/* Phones: "September - November" clips inside a 3-column
                    grid this narrow, so show short month abbreviations there
                    and the full range from sm up. */}
                <span className="sm:hidden">{shortRangeLabel(tab.rangeLabel)}</span>
                <span className="max-sm:hidden">{tab.rangeLabel}</span>
              </span>
            </Link>
          );
        })}
      </nav>
    </PageHero>
  );
}
