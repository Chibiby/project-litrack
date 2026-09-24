import { CalendarDays } from "lucide-react";
import { SCHOOL_TIME_ZONE, parseLocalDateKey } from "@/lib/date-keys";
import type { DashboardQuote } from "@/lib/dashboard/quotes";
import { PageHero } from "@/components/shell/page-hero";

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * v2 dashboard hero. The banner art is right-anchored behind the text; its
 * left half is soft cloud, so the greeting stays legible over it. Desktop
 * carries the rotating quote; mobile carries the date chip instead, because
 * the mobile header has no date.
 */
export function GreetingHero({
  firstName,
  todayKey,
  subtitle,
  bannerSrc,
  quote,
}: {
  firstName: string;
  /** `YYYY-MM-DD`; the snapshot crosses a JSON cache, so it is never a Date. */
  todayKey: string;
  subtitle?: string;
  bannerSrc: string;
  quote: DashboardQuote;
}) {
  const hour = Number(
    new Intl.DateTimeFormat("en-PH", {
      timeZone: SCHOOL_TIME_ZONE,
      hour: "numeric",
      hour12: false,
    }).format(new Date())
  );

  // No timeZone: `parseLocalDateKey` already produced the civil date as a
  // runtime-local midnight, and re-projecting it would shift the day.
  const dateLabel = new Intl.DateTimeFormat("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parseLocalDateKey(todayKey));

  const greeting = greetingFor(hour);

  /*
   * Placement below lg (see PageHero): the teacher's head centre sits at
   * 72.2% of the image, so `right: calc(23% - 272px)` puts it at 77% of the
   * hero from sm to lg, as in the mockup; the narrowest phones use 82% so the
   * hair clears the greeting. Below 440px there is no room beside the
   * greeting, so two unioned gradients hide just the handwriting (left of
   * 64%, above 51%).
   */
  return (
    <PageHero
      bannerSrc={bannerSrc}
      artClassName="right-[calc(18%-272px)] sm:right-[calc(23%-272px)]"
      phoneMaskClassName="max-[439px]:[&>img]:[mask-image:linear-gradient(to_right,transparent_63%,black_65%),linear-gradient(to_bottom,transparent_49%,black_53%)]"
      // lg only (1024–1279): the hero box is narrowest here (sidebar takes a
      // quarter of the viewport, and the art is still full-size and
      // right-0), so the illustration reaches further into the text column
      // than at xl+. A scrim fading out toward the art keeps the greeting
      // readable without touching the shared art geometry or changing
      // anything at xl and up.
      contentClassName="lg:max-xl:bg-gradient-to-r lg:max-xl:from-card/95 lg:max-xl:via-card/70 lg:max-xl:to-transparent lg:max-xl:rounded-2xl"
    >
      <p className="hidden text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300 lg:block">
        {greeting},
      </p>
      <p className="text-2xl font-semibold text-blue-600 dark:text-blue-300 lg:hidden">
        {greeting},
      </p>
      <h1 className="mt-0.5 text-4xl font-extrabold tracking-tight text-slate-950 dark:text-white lg:text-5xl">
        {firstName}! <span aria-hidden>👋</span>
      </h1>
      <p className="mt-2 line-clamp-2 max-w-[13rem] text-base leading-snug lg:line-clamp-none text-slate-600 dark:text-slate-300 sm:max-w-md lg:text-lg lg:text-slate-800">
        {subtitle ?? "Here's what's happening with your class today."}
      </p>
      <blockquote className="mt-4 hidden max-w-lg text-sm italic leading-relaxed text-slate-600 dark:text-slate-300 lg:block">
        &ldquo;{quote.text}&rdquo;
        <footer className="not-italic">— {quote.author}</footer>
      </blockquote>
      <p className="mt-4 inline-flex w-fit items-center gap-2 rounded-xl border border-border/80 bg-card/90 px-3 py-2 text-sm font-semibold text-foreground lg:hidden">
        <CalendarDays aria-hidden className="size-4 text-muted-foreground" />
        {dateLabel}
      </p>
    </PageHero>
  );
}
