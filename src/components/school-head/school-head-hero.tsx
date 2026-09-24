import type { LucideIcon } from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";

/**
 * The School Head hero: thin wrapper over `PageHero`, the same relationship
 * `AralPageHero`, `TermsReportHero` and `KinderChecklistHero` already have to
 * it. Art placement and text column caps are copied verbatim from
 * `AralPageHero` (spec `docs/school-head-ui-rework.md` section 1.4); the
 * optional `meta` line and `stats` grid are copied from
 * `KinderChecklistHero`.
 *
 * Defaults to learner art — per the spec's one-line rule, only the dashboard,
 * Settings and the profiling wizard pass person art (`teacherBannerSrc`);
 * every other School Head page uses this default.
 */
export function SchoolHeadHero({
  eyebrow,
  eyebrowIcon: EyebrowIcon,
  title,
  subtitle,
  meta,
  bannerSrc = "/brand/banner-learner.webp",
  topRight,
  stats,
}: {
  eyebrow: string;
  eyebrowIcon: LucideIcon;
  title: string;
  subtitle: string;
  /** Optional third line, e.g. "SY 2025-2026 · 7 grade levels". */
  meta?: string;
  /** Person art for the three personal pages; defaults to learner art. */
  bannerSrc?: string;
  /** Floated top-right over the art — page actions, pickers. */
  topRight?: React.ReactNode;
  /** Two or three compact StatCards inside the band, as KinderChecklistHero does. */
  stats?: React.ReactNode;
}) {
  return (
    <PageHero
      bannerSrc={bannerSrc}
      className="h-auto"
      topRight={topRight}
      artClassName="max-sm:!h-[160px] max-sm:right-[-118px] sm:h-[75%] sm:right-[calc(50%-338px)] lg:right-[min(0px,calc(100%-1291px))]"
      phoneMaskClassName="max-sm:[&>img]:[mask-image:linear-gradient(to_right,transparent_40%,black_53%)]"
      headClassName="max-lg:hidden"
      contentClassName="justify-start gap-0 px-4 py-4 sm:px-5 sm:py-6 lg:min-h-[17rem] lg:justify-center lg:px-8"
    >
      {/* Below lg: the art's handwritten doodle sits at the same height as
          this text column and the mask doesn't fully hide it, so give the
          text its own scrim to stay legible (z-index plus a
          soft background) — same fix as `AralPageHero`/`TermsReportHero`. */}
      <div className="max-lg:relative max-lg:z-10 max-lg:w-fit max-lg:max-w-[68%] max-lg:rounded-xl max-lg:border max-lg:border-border/70 max-lg:bg-card/90 max-lg:px-2.5 max-lg:py-1.5 max-lg:shadow-card max-lg:backdrop-blur-sm">
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 sm:gap-2 sm:text-sm lg:text-base">
          <EyebrowIcon className="size-3.5 shrink-0 sm:size-4 lg:size-5" aria-hidden />
          {eyebrow}
        </p>
        <h1 className="mt-1.5 max-w-[60%] text-balance text-[1.1875rem] font-extrabold leading-tight tracking-tight text-slate-950 dark:text-white sm:mt-2 sm:max-w-[55%] sm:text-3xl lg:max-w-[46%] lg:text-4xl">
          {title}
        </h1>
        <p className="mt-1 max-w-[56%] text-xs leading-snug text-slate-600 dark:text-slate-300 sm:max-w-[55%] sm:text-sm lg:max-w-[46%] lg:text-lg">
          {subtitle}
        </p>
        {meta ? (
          <p className="mt-0.5 max-w-[56%] text-xs leading-snug text-slate-600 dark:text-slate-300 sm:max-w-[55%] sm:text-sm lg:max-w-[46%]">
            {meta}
          </p>
        ) : null}
      </div>
      {stats ? (
        <div className="mt-3 grid max-w-full grid-cols-2 gap-3 sm:mt-4 sm:gap-4 lg:max-w-[46rem] lg:grid-cols-3">
          {stats}
        </div>
      ) : null}
    </PageHero>
  );
}
