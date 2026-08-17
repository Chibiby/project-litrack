import { Surface } from "@/components/ui/surface";
import { CalendarDays } from "lucide-react";
import { SCHOOL_TIME_ZONE } from "@/lib/date-keys";

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
  today,
  subtitle,
}: {
  firstName: string;
  today: Date;
  subtitle?: string;
}) {
  const hour = Number(
    new Intl.DateTimeFormat("en-PH", {
      timeZone: SCHOOL_TIME_ZONE,
      hour: "numeric",
      hour12: false,
    }).format(new Date())
  );

  const dateLabel = new Intl.DateTimeFormat("en-PH", {
    timeZone: SCHOOL_TIME_ZONE,
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
