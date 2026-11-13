import { Surface } from "@/components/ui/surface";
import { MonthCalendar } from "@/components/shell/month-calendar";
import { parseLocalDateKey } from "@/lib/date-keys";
import type { DashboardQuote } from "@/lib/dashboard/quotes";

/**
 * Right-rail calendar (mockup image 3). Read-only, not a picker: it shows the
 * whole month with today marked, and pages back and forward a month at a time.
 * The month view is `MonthCalendar`, the same one the header's date opens, so
 * the two always match.
 *
 * Plain glass, like the floating header: a translucent white fill, a thin
 * bright border and a backdrop blur. The sky strip is softened so the glass
 * reads through it.
 */
export function CalendarCard({
  todayKey,
  quote,
}: {
  todayKey: string;
  quote: DashboardQuote;
}) {
  const dateLabel = new Intl.DateTimeFormat("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parseLocalDateKey(todayKey));

  return (
    <Surface
      as="section"
      aria-label="Calendar"
      className="overflow-hidden rounded-2xl glass-panel"
    >
      <svg
        viewBox="0 0 280 64"
        aria-hidden
        className="block h-16 w-full opacity-70 dark:opacity-40"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="cal-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#dbeafe" />
            <stop offset="1" stopColor="#ede9fe" />
          </linearGradient>
        </defs>
        <rect width="280" height="64" fill="url(#cal-sky)" />
        <circle cx="196" cy="24" r="11" fill="#fde68a" />
        <path d="M0 64 L0 42 Q40 18 84 38 T168 32 T244 36 T280 26 L280 64 Z" fill="#a5b4fc" opacity=".7" />
        <path d="M0 64 L0 52 Q64 36 124 50 T280 44 L280 64 Z" fill="#818cf8" opacity=".55" />
      </svg>
      <div className="px-4 pb-4 pt-3">
        <p className="border-l-2 border-aral-500 pl-2 text-sm font-semibold text-foreground">
          {dateLabel}
        </p>
        <MonthCalendar todayKey={todayKey} className="mt-3" />
        <p className="mt-3 text-sm italic leading-relaxed text-muted-foreground">
          — &ldquo;{quote.text}&rdquo;
        </p>
      </div>
    </Surface>
  );
}
