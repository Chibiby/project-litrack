import { CalendarCheck, Heart } from "lucide-react";
import { PageHero } from "@/components/shell/page-hero";

/**
 * The v2 Weekly Attendance banner, matching `TermsReportHero`'s art placement
 * and text widths so the copy never runs under the learner art at any width.
 */
export function AttendanceHero({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <PageHero
      bannerSrc="/brand/banner-learner.png"
      className="h-auto"
      artClassName="max-sm:!h-[160px] max-sm:right-[-118px] sm:h-[75%] sm:right-[calc(50%-338px)] lg:right-[min(0px,calc(100%-1291px))]"
      phoneMaskClassName="max-sm:[&>img]:[mask-image:linear-gradient(to_right,transparent_40%,black_53%)]"
      headClassName="max-lg:hidden"
      contentClassName="justify-start gap-0 px-4 py-4 sm:px-5 sm:py-6 lg:min-h-[17rem] lg:justify-center lg:px-8"
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 sm:gap-2 sm:text-sm lg:text-base">
        <CalendarCheck className="size-3.5 shrink-0 sm:size-4 lg:size-5" aria-hidden />
        Weekly Attendance
      </p>
      <h1 className="mt-1.5 max-w-[60%] text-balance text-[1.1875rem] font-extrabold leading-tight tracking-tight text-slate-950 dark:text-white sm:mt-2 sm:max-w-[55%] sm:text-3xl lg:max-w-[46%] lg:text-4xl">
        {title}
      </h1>
      <p className="mt-1 max-w-[56%] text-xs leading-snug text-slate-600 dark:text-slate-300 sm:max-w-[55%] sm:text-sm lg:max-w-[46%] lg:text-lg">
        {subtitle}
      </p>
      <p className="mt-1 flex items-center gap-1 max-w-[56%] text-xs leading-snug text-slate-600 dark:text-slate-300 sm:max-w-[55%] sm:text-sm lg:max-w-[46%] lg:text-lg">
        Together for Brighter Learners!
        <Heart className="size-3 shrink-0 fill-current sm:size-3.5 lg:size-4" aria-hidden />
      </p>
    </PageHero>
  );
}
