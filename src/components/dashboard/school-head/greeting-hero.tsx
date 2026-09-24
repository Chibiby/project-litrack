import { CalendarDays, CalendarRange } from "lucide-react";
import { SCHOOL_TIME_ZONE, parseLocalDateKey } from "@/lib/date-keys";
import type { DashboardQuote } from "@/lib/dashboard/quotes";
import { PageHero } from "@/components/shell/page-hero";

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The School Head dashboard hero. Copied from
 * `src/components/dashboard/teacher/greeting-hero.tsx`, not shared — see
 * `docs/school-head-ui-rework.md` section 3.3 for why sharing would force the
 * teacher component to branch on the default subtitle, the meta chip, the
 * Super Admin override and the quote pool. Adds a `meta` chip line and the
 * Super Admin variant (section 3.8) on top of the teacher shape.
 */
export function SchoolHeadGreetingHero({
  firstName,
  todayKey,
  bannerSrc,
  quote,
  subtitle,
  meta,
  isSuperAdminView = false,
}: {
  /** The head's first name — or, in the Super Admin view, the school's name. */
  firstName: string;
  /** `YYYY-MM-DD`; the snapshot crosses a JSON cache, so it is never a Date. */
  todayKey: string;
  bannerSrc: string;
  quote: DashboardQuote;
  subtitle?: string;
  /** Third line: active school year, grade-level count and section count. */
  meta?: string;
  /** A Super Admin drilling in is inspecting, not being welcomed (section 3.8). */
  isSuperAdminView?: boolean;
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

  const eyebrow = isSuperAdminView ? "Super Admin view" : `${greetingFor(hour)},`;
  const resolvedSubtitle =
    subtitle ??
    (isSuperAdminView
      ? "Every figure below is this school's."
      : "Here's what your school needs today.");

  /*
   * Placement below lg (see PageHero): identical to the teacher greeting
   * hero's values (`docs/school-head-ui-rework.md` section 3.3) — the teacher
   * file is the origin of these two strings, duplicated knowingly rather than
   * editing a component this rework must not touch (spec risk R9).
   */
  return (
    <PageHero
      bannerSrc={bannerSrc}
      artClassName="right-[calc(18%-272px)] sm:right-[calc(23%-272px)]"
      phoneMaskClassName="max-[439px]:[&>img]:[mask-image:linear-gradient(to_right,transparent_63%,black_65%),linear-gradient(to_bottom,transparent_49%,black_53%)]"
    >
      {/*
       * Below lg the hero art is masked to a right-side sliver, so text needs
       * no backing. From xl the section is wide enough that the fade's
       * transparent band (22% of the section) clears the text column on its
       * own. Only lg–xl (1024–1279, `docs` calls this out as the crushed
       * range) is narrow enough that the fade's transparent band is too
       * narrow and the quote/meta text sits on the opaque art and the "Same
       * learners, Brighter tomorrows" doodle — so only that range gets a
       * translucent scrim behind the text.
       */}
      <div className="lg:max-xl:relative lg:max-xl:z-10 lg:max-xl:max-w-[22rem] lg:max-xl:rounded-2xl lg:max-xl:bg-card/85 lg:max-xl:p-4 lg:max-xl:shadow-card lg:max-xl:backdrop-blur-sm">
        <p className="hidden text-xs font-semibold uppercase tracking-[0.14em] text-slate-600 dark:text-slate-300 lg:block">
          {eyebrow}
        </p>
        <p className="text-2xl font-semibold text-blue-600 dark:text-blue-300 lg:hidden">
          {eyebrow}
        </p>
        <h1 className="mt-0.5 text-4xl font-extrabold tracking-tight text-slate-950 dark:text-white lg:text-5xl">
          {isSuperAdminView ? (
            firstName
          ) : (
            <>
              {firstName}! <span aria-hidden>👋</span>
            </>
          )}
        </h1>
        <p className="mt-2 line-clamp-2 max-w-[13rem] text-base leading-snug lg:line-clamp-none text-slate-600 dark:text-slate-300 sm:max-w-md lg:text-lg lg:text-slate-800">
          {resolvedSubtitle}
        </p>
        {meta ? (
          <p className="mt-2 inline-flex w-fit items-center gap-2 rounded-xl border border-border/80 bg-card/90 px-3 py-1.5 text-xs font-medium text-foreground sm:text-sm">
            <CalendarRange aria-hidden className="size-3.5 shrink-0 text-muted-foreground sm:size-4" />
            {meta}
          </p>
        ) : null}
        <blockquote className="mt-4 hidden max-w-lg text-sm italic leading-relaxed text-slate-600 dark:text-slate-300 lg:block">
          &ldquo;{quote.text}&rdquo;
          <footer className="not-italic">— {quote.author}</footer>
        </blockquote>
        <p className="mt-4 inline-flex w-fit items-center gap-2 rounded-xl border border-border/80 bg-card/90 px-3 py-2 text-sm font-semibold text-foreground lg:hidden">
          <CalendarDays aria-hidden className="size-4 text-muted-foreground" />
          {dateLabel}
        </p>
      </div>
    </PageHero>
  );
}
