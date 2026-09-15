import { Surface } from "@/components/ui/surface";
import { buildMonthGrid } from "@/lib/dashboard/month-grid";
import { parseLocalDateKey } from "@/lib/date-keys";
import type { DashboardQuote } from "@/lib/dashboard/quotes";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/**
 * Right-rail calendar (mockup image 3). Decorative, not a picker: nothing on
 * the dashboard is date-navigable. Shows the weeks around today so the rail
 * stays level with the stat row and panels beside it.
 */
export function CalendarCard({
  todayKey,
  quote,
}: {
  todayKey: string;
  quote: DashboardQuote;
}) {
  const { weeks } = buildMonthGrid(todayKey);
  const todayWeek = Math.max(
    weeks.findIndex((w) => w.some((c) => c?.isToday)),
    0
  );
  const shown = weeks.slice(Math.max(todayWeek - 1, 0), todayWeek + 2);

  const dateLabel = new Intl.DateTimeFormat("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parseLocalDateKey(todayKey));

  return (
    <Surface as="section" aria-label="Calendar" className="overflow-hidden rounded-2xl">
      <svg
        viewBox="0 0 280 64"
        aria-hidden
        className="block h-16 w-full"
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
        <p className="border-l-2 border-violet-500 pl-2 text-sm font-semibold text-foreground">
          {dateLabel}
        </p>
        {/* A div grid, not a table element: tables are reserved for the ui/table primitive, and this is a picture of a month, not tabular data. */}
        <div role="presentation" className="mt-3 grid grid-cols-7 gap-y-1 text-center text-xs">
          {WEEKDAYS.map((d, i) => (
            <span key={`h${i}`} aria-hidden className="pb-1 font-medium text-muted-foreground">
              {d}
            </span>
          ))}
          {shown.flat().map((c, i) =>
            c ? (
              <span
                key={c.key}
                aria-current={c.isToday ? "date" : undefined}
                className={cn(
                  "mx-auto flex size-7 items-center justify-center rounded-full tabular-nums text-foreground",
                  c.isToday && "bg-violet-600 font-semibold text-white"
                )}
              >
                {c.day}
              </span>
            ) : (
              <span key={`e${i}`} aria-hidden />
            )
          )}
        </div>
        <p className="mt-3 text-sm italic leading-relaxed text-muted-foreground">
          — &ldquo;{quote.text}&rdquo;
        </p>
      </div>
    </Surface>
  );
}
