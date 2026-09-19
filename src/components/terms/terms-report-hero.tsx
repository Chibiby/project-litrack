import Link from "next/link";
import { FileText, Lock } from "lucide-react";
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
      // Phones: the art is a fixed 160px tall and pushed right until the girl
      // meets the band's edge, so both children sit beside the text as in the
      // phone mockup; the handwriting fades out under the title.
      artClassName="max-sm:!h-[160px] max-sm:right-[-118px] sm:h-[75%] sm:right-[calc(50%-338px)] lg:right-[min(0px,calc(100%-1291px))]"
      phoneMaskClassName="max-sm:[&>img]:[mask-image:linear-gradient(to_right,transparent_40%,black_53%)]"
      headClassName="max-lg:hidden"
      contentClassName="justify-start gap-0 px-4 py-4 sm:px-5 sm:py-6 lg:min-h-[17rem] lg:justify-center lg:px-8"
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 sm:gap-2 sm:text-sm lg:text-base">
        <FileText className="size-3.5 shrink-0 sm:size-4 lg:size-5" aria-hidden />
        End of Terms Reports
      </p>
      {/* Half the band at most, so the title wraps before it reaches the art's
          handwriting; balanced so "Grade 3" never sits alone on a line. */}
      <h1 className="mt-1.5 max-w-[60%] text-balance text-[1.1875rem] font-extrabold leading-tight tracking-tight text-slate-950 dark:text-white sm:mt-2 sm:max-w-[55%] sm:text-3xl lg:max-w-[46%] lg:text-4xl">
        {title}
      </h1>
      <p className="mt-1 max-w-[56%] text-xs leading-snug text-slate-600 dark:text-slate-300 sm:max-w-[55%] sm:text-sm lg:max-w-[46%] lg:text-lg">
        {subtitle}
      </p>

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
                "flex min-w-0 flex-col rounded-lg border px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:rounded-xl sm:px-4 sm:py-2",
                active
                  ? "border-transparent bg-gradient-to-r from-violet-600 to-violet-500 text-white shadow-sm shadow-violet-500/30"
                  : "border-border bg-card/90 text-foreground hover:bg-card"
              )}
            >
              <span className="flex items-center gap-1 truncate text-xs font-semibold sm:gap-1.5 sm:text-base">
                {tab.label}
                {tab.locked ? <Lock className="size-3.5 shrink-0" aria-label="Locked" /> : null}
              </span>
              <span
                className={cn(
                  "truncate text-[10px] sm:text-sm",
                  active ? "text-white/85" : "text-muted-foreground"
                )}
              >
                {tab.rangeLabel}
              </span>
            </Link>
          );
        })}
      </nav>
    </PageHero>
  );
}
