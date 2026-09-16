import { FileCheck2, FileText, GraduationCap, Info, Users } from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";
import { StatCard } from "@/components/dashboard/teacher/stat-cards";

export interface KinderChecklistHeroProps {
  title: string;
  /** The line directly under the title — on this page always the grade level, "Kindergarten". */
  subtitle: string;
  /** Optional third line: the section and school year, kept smaller than the subtitle. */
  meta?: string;
  /** The resolved Kindergarten advisory's section name, or `null` before one is chosen (spec section 4's "unspecified" state). */
  advisoryLabel: string | null;
  /** The open learner's full name, or `null` when the roster is empty (the page opens on the roster's first learner by default). */
  learnerName: string | null;
  /** The open learner's 1-based position in the roster, or `null` when there is no open learner. */
  learnerPosition?: number | null;
  /** The roster's size, paired with `learnerPosition` for the "N of M" hint. */
  learnerCount?: number;
  /** How many of the 62 competencies have at least one rating, per `countTouchedCompetencies` (spec section 9). */
  touched: number;
  total: number;
  pct: number;
  /**
   * The advisory switcher, floated in the hero's top-right corner — the same
   * placement the numeric End of Terms page uses (`TermsAdvisoryHeroControl`).
   * Omitted entirely when the teacher holds only one Kindergarten advisory,
   * since there is nothing to switch.
   */
  topRight?: React.ReactNode;
}

/**
 * The Kindergarten checklist banner: thin wrapper over `PageHero`, the same
 * relationship `AralPageHero`/`AttendanceHero` already have to it. Three
 * `StatCard`s only — Advisory, Learner, Progress — no term dropdown, because
 * all three terms are columns in the grid below, not a page-level filter.
 */
export function KinderChecklistHero({
  title,
  subtitle,
  meta,
  advisoryLabel,
  learnerName,
  learnerPosition,
  learnerCount,
  touched,
  total,
  pct,
  topRight,
}: KinderChecklistHeroProps) {
  return (
    <>
      <PageHero
        bannerSrc="/brand/banner-learner.png"
        className="h-auto"
        topRight={topRight}
        artClassName="max-sm:!h-[160px] max-sm:right-[-118px] sm:h-[75%] sm:right-[calc(50%-338px)] lg:right-[min(0px,calc(100%-1291px))]"
        phoneMaskClassName="max-sm:[&>img]:[mask-image:linear-gradient(to_right,transparent_40%,black_53%)]"
        headClassName="max-lg:hidden"
        contentClassName="justify-start gap-0 px-4 py-4 sm:px-5 sm:py-6 lg:min-h-[17rem] lg:justify-center lg:px-8"
      >
        <h1 className="max-w-[60%] text-balance text-[1.1875rem] font-extrabold leading-tight tracking-tight text-slate-950 dark:text-white sm:max-w-[55%] sm:text-3xl lg:max-w-[46%] lg:text-4xl">
          {title}
        </h1>
        <p className="mt-1 flex max-w-[56%] items-center gap-1.5 text-sm font-semibold leading-snug text-slate-700 dark:text-slate-200 sm:max-w-[55%] sm:gap-2 sm:text-base lg:max-w-[46%] lg:text-lg">
          <FileText className="size-3.5 shrink-0 sm:size-4" aria-hidden />
          {subtitle}
        </p>
        {meta ? (
          <p className="mt-0.5 max-w-[56%] text-xs leading-snug text-slate-600 dark:text-slate-300 sm:max-w-[55%] sm:text-sm lg:max-w-[46%]">
            {meta}
          </p>
        ) : null}

        <div className="mt-3 grid max-w-full grid-cols-2 gap-3 sm:mt-4 sm:gap-4 lg:max-w-[46rem] lg:grid-cols-3">
          <StatCard
            title="Advisory"
            value={advisoryLabel ?? "Not chosen"}
            hint="Kindergarten section"
            icon={GraduationCap}
            tone="violet"
            inlineOnPhone
            denseOnPhone
            valueClassName="text-xl sm:text-2xl"
          />
          <StatCard
            title="Learner"
            value={learnerName ?? "None selected"}
            hint={
              learnerPosition && learnerCount
                ? `${learnerPosition} of ${learnerCount}`
                : "Currently open checklist"
            }
            icon={Users}
            tone="primary"
            inlineOnPhone
            denseOnPhone
            valueClassName="text-xl sm:text-2xl"
          />
          <StatCard
            title="Progress"
            value={`${touched} / ${total}`}
            hint="Competencies rated"
            icon={FileCheck2}
            tone="emerald"
            inlineOnPhone
            denseOnPhone
            progress={pct}
            progressLabel={`${touched} of ${total} competencies rated`}
          />
        </div>
      </PageHero>
      <KinderLanguageNote />
    </>
  );
}

/**
 * The one Filipino-related line in the whole feature (spec owner decision 1):
 * its own info strip under the banner, not inside the hero, where it sat over
 * the artwork and could not be read.
 */
function KinderLanguageNote() {
  return (
    <p className="mt-3 flex items-start gap-2 rounded-xl border border-border/80 bg-muted/40 px-3 py-2 text-xs leading-snug text-muted-foreground sm:text-sm">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      Terms 1 and 2 are evaluated in Filipino; Term 3 is evaluated in English.
    </p>
  );
}
