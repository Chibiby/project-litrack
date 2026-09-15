import Image from "next/image";
import { CalendarDays } from "lucide-react";
import { SCHOOL_TIME_ZONE, parseLocalDateKey } from "@/lib/date-keys";
import type { DashboardQuote } from "@/lib/dashboard/quotes";

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
   * The banner PNG is 2172×579 with a transparent top strip (rows 0–46) that
   * only the character's head reaches into. The band — rows 47–578, 532px —
   * fills this section exactly, so the image is drawn at 579/532 = 108.83% of
   * the section's height, bottom- and right-anchored.
   *
   * Two layers of the same image make the head "pop out":
   *  1. the band, clipped by a rounded, overflow-hidden box;
   *  2. a strip 47/532 = 8.83% tall sitting directly above the section,
   *     showing only the image's top rows — the head rising past the edge.
   * Both layers anchor to the same right edge at the same height, so they line
   * up pixel for pixel.
   *
   * Below lg the hero is a fixed 15rem, so the art is exactly 261px tall and
   * 980px wide, and it is placed by the character rather than by a percentage
   * that drifts with width: the head centre sits at 72.2% of the image, so
   * `right: calc(23% - 272px)` puts it at 77% of the hero from sm to lg, as in
   * the mockup; the narrowest phones use 82% so the hair clears the greeting.
   * The art is shown unfaded on phones, handwriting included, as in the
   * mockup (image 4). Below 440px there is no room beside the greeting, so
   * two unioned gradients hide just the handwriting (left of 64%, above 51%).
   * Wide screens fade the art's left edge into the band.
   *
   * From lg the art is zoomed 1.25× to make the character bigger without
   * changing the section's size: it is drawn at 108.83% × 1.25 = 136.04% and
   * top-anchored at -8.83%, so the head still rises exactly as far above the
   * band as before and the extra height is cropped off the bottom (clouds,
   * already under the stat cards). The head strip stays 8.83% tall, so its
   * image is 136.04 / 8.83 = 1540.7% of the strip.
   */
  const art = (
    <Image
      src={bannerSrc}
      alt=""
      aria-hidden
      width={2172}
      height={579}
      priority
      sizes="(min-width: 1024px) 80vw, 250vw"
      className="absolute right-[calc(18%-272px)] top-auto h-[108.83%] w-auto max-w-none sm:right-[calc(23%-272px)] lg:right-0"
    />
  );

  // mt-2, not more: the head strip rises ~8.8% of the band above the
  // section, and the page padding above already gives it room.
  return (
    <section className="relative isolate mt-2 h-[15rem] lg:h-auto">
      {/* Layer 1: the band. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 overflow-hidden rounded-2xl bg-gradient-to-br from-violet-50 via-sky-50 to-violet-100/60 dark:from-card dark:via-card dark:to-card [&>img]:bottom-0 lg:[&>img]:bottom-auto lg:[&>img]:top-[-8.83%] lg:[&>img]:h-[136.04%] max-[439px]:[&>img]:[mask-image:linear-gradient(to_right,transparent_63%,black_65%),linear-gradient(to_bottom,transparent_49%,black_53%)] lg:[&>img]:[mask-image:linear-gradient(to_right,transparent,black_22%)] dark:[&>img]:opacity-80"
      >
        {art}
      </div>
      {/* Layer 2: the head, above the band's top edge. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-full h-[8.83%] overflow-hidden [&>img]:top-0 [&>img]:h-[1232.5%] lg:[&>img]:h-[1540.7%] dark:[&>img]:opacity-80"
      >
        {art}
      </div>
      <div className="flex h-full flex-col justify-center px-5 py-6 lg:min-h-[19rem] lg:px-8 lg:py-6">
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
      </div>
    </section>
  );
}
