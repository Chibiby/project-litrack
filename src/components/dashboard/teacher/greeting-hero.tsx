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
   * up pixel for pixel. On phones the art is pushed right and its left side
   * (the handwriting) faded out, so the character sits beside the greeting
   * without writing over it (mockup image 4).
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
      className="absolute right-[-70%] top-auto h-[108.83%] w-auto max-w-none sm:right-[-40%] lg:right-0"
    />
  );

  return (
    <section className="relative isolate mt-6">
      {/* Layer 1: the band. */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 overflow-hidden rounded-2xl bg-gradient-to-br from-violet-50 via-sky-50 to-violet-100/60 dark:from-card dark:via-card dark:to-card [&>img]:bottom-0 [&>img]:[mask-image:linear-gradient(to_right,transparent_59%,black_64%)] lg:[&>img]:[mask-image:linear-gradient(to_right,transparent,black_22%)] dark:[&>img]:opacity-80"
      >
        {art}
      </div>
      {/* Layer 2: the head, above the band's top edge. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-full h-[8.83%] overflow-hidden [&>img]:top-0 [&>img]:h-[1232.5%] dark:[&>img]:opacity-80"
      >
        {art}
      </div>
      <div className="flex min-h-[15rem] flex-col justify-center px-5 py-6 lg:min-h-[19rem] lg:px-8 lg:py-6">
        <p className="hidden text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300 lg:block">
          {greeting},
        </p>
        <p className="text-2xl font-semibold text-blue-600 dark:text-blue-300 lg:hidden">
          {greeting},
        </p>
        <h1 className="mt-0.5 text-4xl font-extrabold tracking-tight text-slate-950 dark:text-white lg:text-5xl">
          {firstName}! <span aria-hidden>👋</span>
        </h1>
        <p className="mt-2 max-w-[13rem] text-base leading-snug text-slate-600 dark:text-slate-300 sm:max-w-md lg:text-lg lg:text-slate-800">
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
