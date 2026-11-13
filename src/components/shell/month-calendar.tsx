"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildMonthGrid } from "@/lib/dashboard/month-grid";
import { formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** First day of the month `offset` months from the month holding `todayKey`. */
function monthStartKey(todayKey: string, offset: number): string {
  const today = parseLocalDateKey(todayKey);
  return formatLocalDateKey(new Date(today.getFullYear(), today.getMonth() + offset, 1));
}

/**
 * A read-only month view with previous / next month buttons. Nothing here
 * picks a date: it is for looking ahead or back. Today keeps its violet mark
 * in whichever month holds it, and a "Today" button jumps back once you have
 * paged away.
 *
 * Shared by the header's calendar popover and the dashboard's calendar card,
 * so the two always look and behave the same.
 */
export function MonthCalendar({
  todayKey,
  className,
}: {
  /** Local `YYYY-MM-DD` for today in the school's timezone. */
  todayKey: string;
  className?: string;
}) {
  const [offset, setOffset] = useState(0);
  const { monthLabel, weeks } = buildMonthGrid(todayKey, monthStartKey(todayKey, offset));

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2">
        <p aria-live="polite" className="text-sm font-semibold text-foreground">
          {monthLabel}
        </p>
        <div className="flex items-center gap-1">
          {offset !== 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 rounded-full px-2.5 text-xs hover:bg-glass/40 dark:hover:bg-glass/10"
              onClick={() => setOffset(0)}
            >
              Today
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Previous month"
            className="size-7 rounded-full hover:bg-glass/40 dark:hover:bg-glass/10"
            onClick={() => setOffset((o) => o - 1)}
          >
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Next month"
            className="size-7 rounded-full hover:bg-glass/40 dark:hover:bg-glass/10"
            onClick={() => setOffset((o) => o + 1)}
          >
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      {/* A div grid, not a table element: tables are reserved for the ui/table
          primitive, and this is a picture of a month, not tabular data. */}
      <div role="presentation" className="mt-3 grid grid-cols-7 gap-y-1 text-center text-xs">
        {WEEKDAYS.map((d, i) => (
          <span key={`h${i}`} aria-hidden className="pb-1 font-medium text-muted-foreground">
            {d}
          </span>
        ))}
        {weeks.flat().map((c, i) =>
          c ? (
            <span
              key={c.key}
              aria-current={c.isToday ? "date" : undefined}
              className={cn(
                "mx-auto flex size-7 items-center justify-center rounded-full tabular-nums text-foreground",
                c.isToday && "bg-aral-600 font-semibold text-white"
              )}
            >
              {c.day}
            </span>
          ) : (
            <span key={`e${i}`} aria-hidden />
          )
        )}
      </div>
    </div>
  );
}
