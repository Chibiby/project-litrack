import { STAT_GRID } from "@/components/dashboard/teacher/stat-cards";
import type { LucideIcon } from "lucide-react";
import { CompactPageHeader, PageHero, eyebrowRepeatsTitle } from "@/components/shell/page-hero";
import { cn } from "@/lib/utils";

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
  variant = "illustrated",
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
  /**
   * `"illustrated"` (default): the banded art hero every existing caller
   * keeps. `"compact"`: `CompactPageHeader` instead — eyebrow + H1 + one line,
   * no art, ~100px. `stats` is ignored in this variant: a tool page dense
   * enough to need stat tiles belongs in the illustrated hero, not this one.
   */
  variant?: "illustrated" | "compact";
}) {
  if (variant === "compact") {
    return (
      <CompactPageHeader
        eyebrow={eyebrow}
        eyebrowIcon={EyebrowIcon}
        title={title}
        subtitle={subtitle}
        meta={meta}
        topRight={topRight}
      />
    );
  }

  return (
    <PageHero
      bannerSrc={bannerSrc}
      className="h-auto"
      topRight={topRight}
      // Phones: a top-right control (the Schools "+") would sit on the
      // girl's face, so the art is drawn smaller and further left, under it.
      artClassName={cn(
        "sm:right-[min(0px,calc(50%-375px))] lg:right-[min(0px,calc(100%-1291px))]",
        topRight
          ? "max-sm:!h-[112px] max-sm:right-[-38px]"
          : "max-sm:!h-[140px] max-sm:right-[-112px]",
        // Stat tiles make the band tall; below lg the art keeps the height it
        // has without them instead of scaling up behind the title.
        stats && "sm:max-lg:!h-[10.5rem]"
      )}
      // Phones: with stat tiles in the band the hero grows tall, and
      // bottom-anchored art would land beside a tile; pin it to the top, next
      // to the title, instead.
      // Pinned to the top, the art's bottom edge would show as a hard line
      // across the band, so a second mask fades it out (intersected with the
      // left-edge fade).
      phoneMaskClassName={
        stats
          ? "max-sm:[&>img]:[mask-image:linear-gradient(to_right,transparent_45%,black_56%),linear-gradient(to_bottom,black_70%,transparent)] sm:max-lg:[&>img]:[mask-image:linear-gradient(to_right,transparent_30%,black_45%),linear-gradient(to_bottom,black_70%,transparent)] max-lg:[&>img]:[mask-composite:intersect] max-lg:[&>img]:!bottom-auto max-lg:[&>img]:top-0 lg:[&>img]:!top-0 lg:[&>img]:!h-[20rem] lg:[&>img]:[mask-image:linear-gradient(to_right,transparent,black_22%),linear-gradient(to_bottom,black_75%,transparent)] lg:[&>img]:[mask-composite:intersect]"
          : "max-sm:[&>img]:[mask-image:linear-gradient(to_right,transparent_45%,black_56%)] sm:max-lg:[&>img]:[mask-image:linear-gradient(to_right,transparent_30%,black_45%)]"
      }
      // Desktop: with stat tiles the band is tall, and the art (sized to the
      // band) would grow until its doodle sat under the description. It keeps
      // a fixed 20rem from the top instead, fading out at the bottom, and the
      // head strip above the band (sized for the zoomed art) is left out.
      headClassName={stats ? "hidden" : "max-lg:hidden"}
      contentClassName="justify-start gap-0 px-4 py-4 sm:px-5 sm:py-6 lg:min-h-[17rem] lg:justify-center lg:px-8"
    >
      <div className="relative z-10">
        {eyebrowRepeatsTitle(eyebrow, title) ? null : (
          <p className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 sm:gap-2 sm:text-sm lg:text-base">
            <EyebrowIcon className="size-3.5 shrink-0 sm:size-4 lg:size-5" aria-hidden />
            {eyebrow}
          </p>
        )}
        <h1 className="mt-1.5 max-w-[60%] text-balance text-[1.1875rem] font-extrabold leading-tight tracking-tight text-slate-950 dark:text-white sm:mt-2 sm:max-w-[48%] sm:text-3xl lg:max-w-[46%] lg:text-4xl">
          {title}
        </h1>
        <p className="mt-1 max-w-[50%] text-xs leading-snug max-sm:line-clamp-2 text-slate-600 dark:text-slate-300 sm:max-w-[48%] sm:text-sm lg:max-w-[46%] lg:text-lg">
          {subtitle}
        </p>
        {meta ? (
          <p className="mt-0.5 max-w-[50%] text-xs leading-snug max-sm:hidden text-slate-600 dark:text-slate-300 sm:max-w-[48%] sm:text-sm lg:max-w-[46%]">
            {meta}
          </p>
        ) : null}
      </div>
      {stats ? (
        <div className={cn(STAT_GRID, "mt-3 max-w-full sm:mt-4 lg:max-w-[46rem]")}>
          {stats}
        </div>
      ) : null}
    </PageHero>
  );
}
