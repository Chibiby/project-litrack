import { Heart, type LucideIcon } from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";

/**
 * The shared v2 ARAL banner: same learner art, same art placement/masking and
 * responsive text widths on every ARAL page, only the eyebrow icon/text,
 * title, and subtitle change. `AttendanceHero` is a thin wrapper over this.
 */
export function AralPageHero({
  eyebrow,
  eyebrowIcon: EyebrowIcon,
  title,
  subtitle,
  /** Extra explanatory line under the subtitle, same text column as the rest. */
  description,
  tagline = "Together for Brighter Learners!",
}: {
  eyebrow: string;
  eyebrowIcon: LucideIcon;
  title: string;
  subtitle: string;
  description?: string;
  /** Set to `null` to omit the tagline line entirely. */
  tagline?: string | null;
}) {
  return (
    <PageHero
      bannerSrc="/brand/banner-learner.webp"
      className="h-auto"
      artClassName="max-sm:!h-[160px] max-sm:right-[-118px] sm:h-[75%] sm:right-[calc(50%-338px)] lg:right-[min(0px,calc(100%-1291px))]"
      phoneMaskClassName="max-sm:[&>img]:[mask-image:linear-gradient(to_right,transparent_40%,black_53%)]"
      headClassName="max-lg:hidden"
      contentClassName="justify-start gap-0 px-4 py-4 sm:px-5 sm:py-6 lg:min-h-[17rem] lg:justify-center lg:px-8"
    >
      {/* Below lg: the art's handwritten doodle sits at the same height as
          this text column and the mask doesn't fully hide it once the
          subtitle/description runs past one line, so give the text its own
          scrim to stay legible (z-index plus a soft background). */}
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
        {description ? (
          <p className="mt-1 max-w-[56%] text-xs leading-snug text-slate-600 dark:text-slate-300 sm:max-w-[55%] sm:text-sm lg:max-w-[46%] lg:text-base">
            {description}
          </p>
        ) : null}
        {tagline != null ? (
          <p className="mt-1 flex items-center gap-1 max-w-[56%] text-xs leading-snug text-slate-600 dark:text-slate-300 sm:max-w-[55%] sm:text-sm lg:max-w-[46%] lg:text-lg">
            {tagline}
            <Heart className="size-3 shrink-0 fill-current sm:size-3.5 lg:size-4" aria-hidden />
          </p>
        ) : null}
      </div>
    </PageHero>
  );
}
