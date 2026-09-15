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

  return (
    <section className="relative isolate overflow-hidden rounded-2xl border border-border/60 bg-violet-50/70 dark:bg-card/70 lg:border-0">
      <Image
        src={bannerSrc}
        alt=""
        aria-hidden
        fill
        priority
        sizes="(min-width: 1280px) 70vw, 100vw"
        className="-z-10 object-cover object-[78%_center] dark:opacity-75 lg:object-right"
      />
      <div className="flex min-h-[15rem] flex-col justify-center px-5 py-6 lg:min-h-[14rem] lg:px-7 lg:py-5">
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
