"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addDays, formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";
import { addMonths } from "@/lib/month-range";
import { getMonday } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Props = {
  value: string;
  onNavigate: (nextValue: string) => void;
  label: string;
  prevLabel: string;
  nextLabel: string;
  /** When true (weekly nav), step ±7 days and snap picker value to Monday. */
  snapToMonday?: boolean;
  /**
   * When true (monthly nav), step whole months and snap to the 1st. The picker
   * becomes an `<input type="month">`, since a day picker asks the teacher to
   * choose a date when the only thing that varies is the month.
   */
  snapToMonth?: boolean;
  pending?: boolean;
  /** Optional control rendered after the next button (e.g. Filter). */
  filter?: ReactNode;
  /** Right-aligned actions (e.g. Save). */
  actions?: ReactNode;
  /** Show `prevLabel` / `nextLabel` as button text instead of icon-only. */
  navLabels?: boolean;
  /**
   * Human range for the current period (e.g. `August 11 – 17, 2026`). Supplying
   * it puts the picker between the prev/next buttons and leads with the range,
   * since the range is what the teacher reads and the input is the way in.
   */
  rangeLabel?: string;
};

export function AralDateNav({
  value,
  onNavigate,
  label,
  prevLabel,
  nextLabel,
  snapToMonday,
  snapToMonth,
  pending,
  filter,
  actions,
  navLabels,
  rangeLabel,
}: Props) {
  const current = parseLocalDateKey(value);
  const step = snapToMonday ? 7 : 1;
  const prevValue = snapToMonth
    ? formatLocalDateKey(addMonths(current, -1))
    : formatLocalDateKey(addDays(current, -step));
  const nextValue = snapToMonth
    ? formatLocalDateKey(addMonths(current, 1))
    : formatLocalDateKey(addDays(current, step));

  function handleChange(raw: string) {
    if (!raw) return;
    if (snapToMonth) {
      // `<input type="month">` reports `YYYY-MM`; the app's period key is a full
      // local date, so anchor it on the 1st.
      onNavigate(`${raw}-01`);
      return;
    }
    const next = snapToMonday
      ? formatLocalDateKey(getMonday(parseLocalDateKey(raw)))
      : raw;
    onNavigate(next);
  }

  const pickerInput = snapToMonth ? (
    <Input
      type="month"
      value={value.slice(0, 7)}
      aria-label={label}
      className={
        rangeLabel != null
          ? "h-6 w-auto border-0 bg-transparent p-0 text-xs text-muted-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          : "h-8 w-auto"
      }
      onChange={(e) => handleChange(e.target.value)}
    />
  ) : (
    <Input
      type="date"
      value={value}
      aria-label={label}
      className={
        rangeLabel != null
          ? "h-6 w-auto border-0 bg-transparent p-0 text-xs text-muted-foreground shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          : "h-8 w-auto"
      }
      onChange={(e) => handleChange(e.target.value)}
    />
  );

  const picker =
    rangeLabel != null ? (
      <label className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5">
        <span className="text-sm font-medium text-foreground">{rangeLabel}</span>
        {pickerInput}
      </label>
    ) : (
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        {label}
        {pickerInput}
      </label>
    );

  const prevButton = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={prevLabel}
      title={prevLabel}
      onClick={() => onNavigate(prevValue)}
    >
      <ChevronLeft className="h-4 w-4" />
      {navLabels ? prevLabel : null}
    </Button>
  );

  const nextButton = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={nextLabel}
      title={nextLabel}
      onClick={() => onNavigate(nextValue)}
    >
      {navLabels ? nextLabel : null}
      <ChevronRight className="h-4 w-4" />
    </Button>
  );

  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b border-border/60 p-4"
      aria-busy={pending || undefined}
    >
      {rangeLabel != null ? (
        <>
          {prevButton}
          {picker}
          {nextButton}
        </>
      ) : (
        <>
          {picker}
          {prevButton}
          {nextButton}
        </>
      )}
      {filter}
      {actions != null && (
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
