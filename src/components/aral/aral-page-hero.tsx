import type { LucideIcon } from "lucide-react";
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
  /** Extra explanatory line under the subtitle, same text column as the rest. Hidden on phones. */
  description,
}: {
  eyebrow: string;
  eyebrowIcon: LucideIcon;
  title: string;
  subtitle: string;
  description?: string;
}) {
  return (
    <PageHero
      bannerSrc="/brand/banner-learner.webp"
      className="h-auto"
      artClassName="max-sm:!h-[140px] max-sm:right-[-112px] sm:right-[calc(50%-375px)] lg:right-[min(0px,calc(100%-1291px))]"
      phoneMaskClassName="max-sm:[&>img]:[mask-image:linear-gradient(to_right,transparent_45%,black_56%)] sm:max-lg:[&>img]:[mask-image:linear-gradient(to_right,transparent_30%,black_45%)]"
      headClassName="max-lg:hidden"
      contentClassName="justify-start gap-0 px-4 py-4 sm:px-5 sm:py-6 lg:min-h-[17rem] lg:justify-center lg:px-8"
    >
      <div className="relative z-10">
        <p className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 sm:gap-2 sm:text-sm lg:text-base">
          <EyebrowIcon className="size-3.5 shrink-0 sm:size-4 lg:size-5" aria-hidden />
          {eyebrow}
        </p>
        <h1 className="mt-1.5 max-w-[60%] text-balance text-[1.1875rem] font-extrabold leading-tight tracking-tight text-slate-950 dark:text-white sm:mt-2 sm:max-w-[55%] sm:text-3xl lg:max-w-[46%] lg:text-4xl">
          {title}
        </h1>
        <p className="mt-1 max-w-[50%] text-xs leading-snug text-slate-600 dark:text-slate-300 max-sm:line-clamp-2 sm:max-w-[48%] sm:text-sm lg:max-w-[46%] lg:text-lg">
          {subtitle}
        </p>
        {description ? (
          <p className="mt-1 hidden max-w-[50%] text-xs leading-snug text-slate-600 dark:text-slate-300 sm:block sm:max-w-[48%] sm:text-sm lg:max-w-[46%] lg:text-base">
            {description}
          </p>
        ) : null}
      </div>
    </PageHero>
  );
}
