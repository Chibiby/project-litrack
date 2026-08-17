import { Surface } from "@/components/ui/surface";
import { CalendarDays } from "lucide-react";
import { SCHOOL_TIME_ZONE, parseLocalDateKey } from "@/lib/date-keys";

/**
 * The dashboard's opening line and date.
 *
 * The date reads as a static stamp, not a picker: the whole page is scoped to
 * the current week and month, and LITRACK has no historical dashboard to
 * navigate to, so a control that looked interactive would promise a view that
 * does not exist. It is labelled as today's date instead.
 */

function greetingFor(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function GreetingHeader({
  firstName,
  todayKey,
  subtitle,
}: {
  firstName: string;
  /** `YYYY-MM-DD`; the snapshot crosses a JSON cache, so it is never a Date. */
  todayKey: string;
  subtitle?: string;
}) {
  const today = parseLocalDateKey(todayKey);

  const hour = Number(
    new Intl.DateTimeFormat("en-PH", {
      timeZone: SCHOOL_TIME_ZONE,
      hour: "numeric",
      hour12: false,
    }).format(new Date())
  );

  // Deliberately no timeZone here. `parseLocalDateKey` already produced the
  // intended civil date as a runtime-local midnight, so re-projecting it into
  // Manila would shift it a day whenever the runtime is ahead of UTC+8.
  // The hour lookup above is the opposite case: it reads a real instant, so it
  // does need the school's zone.
  const dateLabel = new Intl.DateTimeFormat("en-PH", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(today);

  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
          {greetingFor(hour)}, {firstName}!
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {subtitle ?? "Here's what's happening with your class today."}
        </p>
      </div>

      <Surface className="flex shrink-0 items-center gap-2.5 px-4 py-2.5">
        <CalendarDays aria-hidden className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{dateLabel}</span>
      </Surface>
    </div>
  );
}
