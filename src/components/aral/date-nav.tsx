"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addDays, formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";
import { addMonths } from "@/lib/month-range";
import { cn, getMonday } from "@/lib/utils";
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
  /**
   * Periods to choose from. Supplying them replaces the date input with a
   * dropdown of named periods — the weekly sheet's way in, because a day picker
   * asks the teacher to pick a date when the only thing that varies is which
   * week, and the answer they hold in their head is "the week of the 7th".
   *
   * `value` must be one of these: a `<Select>` whose value matches no item
   * renders an empty trigger.
   */
  options?: DateNavOption[];
};

export type DateNavOption = { value: string; label: string };

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
  options,
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

  const periodSelect = options != null && (
    <Select value={value} onValueChange={onNavigate}>
      <SelectTrigger
        aria-label={label}
        className={cn(
          // A phone gives it the whole row, at a 44px touch height. Wider screens
          // hold it at a width the longest label fits, so the box does not resize
          // as the teacher moves between periods.
          "h-11 w-full gap-2 bg-background text-sm font-medium sm:h-9 sm:w-auto",
          snapToMonth ? "sm:min-w-[13rem]" : "sm:min-w-[21rem]"
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-[22rem]">
        <SelectGroup>
          <SelectLabel>{label}</SelectLabel>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );

  const picker =
    periodSelect ||
    (rangeLabel != null ? (
      <label className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5">
        <span className="text-sm font-medium text-foreground">{rangeLabel}</span>
        {pickerInput}
      </label>
    ) : (
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        {label}
        {pickerInput}
      </label>
    ));

  // A bare chevron is a 36px target that says nothing about what it steps. On a
  // phone, where the buttons get their own row and there is width to spend, they
  // carry their label at a 44px height; from `sm` up they collapse back to the
  // icon-only square the desktop row was drawn around, unless `navLabels` asks
  // for the text at every width.
  const stepButtonClass = "h-11 w-full sm:h-9 sm:w-auto";

  /** Whether the period sits between the step buttons (every current caller). */
  const leadsWithPrev = rangeLabel != null || options != null;

  const prevButton = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={prevLabel}
      title={prevLabel}
      className={stepButtonClass}
      onClick={() => onNavigate(prevValue)}
    >
      <ChevronLeft className="h-4 w-4" />
      {navLabels ? prevLabel : <span className="sm:hidden">{prevLabel}</span>}
    </Button>
  );

  const nextButton = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-label={nextLabel}
      title={nextLabel}
      className={stepButtonClass}
      onClick={() => onNavigate(nextValue)}
    >
      {navLabels ? nextLabel : <span className="sm:hidden">{nextLabel}</span>}
      <ChevronRight className="h-4 w-4" />
    </Button>
  );

  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b border-border/60 p-4"
      aria-busy={pending || undefined}
    >
      {/*
        Three groups, and on a phone each owns a full row: the period, then the
        filters, then the actions. `sm:contents` dissolves every wrapper from the
        `sm` breakpoint up, so the desktop row is the same single line of flex
        children it has always been — the wrappers exist only for the narrow
        composition. Left as one wrapping row, a phone squeezed the period
        dropdown to "Se…" to make space for a facet select beside it.
      */}
      <div className="grid w-full grid-cols-2 items-center gap-2 sm:contents">
        {leadsWithPrev ? prevButton : null}
        {/*
          `order-first` lifts the period above the buttons on a phone without
          moving it in the DOM, so the desktop row keeps its authored order once
          the wrappers dissolve. `order` does not apply to a `display: contents`
          box, so it costs the wide layout nothing.
        */}
        <div
          className={cn("col-span-2 sm:contents", leadsWithPrev && "order-first")}
        >
          {picker}
        </div>
        {leadsWithPrev ? null : prevButton}
        {nextButton}
      </div>
      {filter != null && (
        <div className="grid w-full grid-cols-2 gap-2 sm:contents">{filter}</div>
      )}
      {actions != null && (
        // Two columns on a phone, matching the rows above, so Save is a real
        // target rather than a 53px afterthought. Deliberately not full-bleed:
        // the assistant button floats over the bottom-right of the viewport,
        // and anything pinned to the right edge scrolls underneath it.
        <div className="grid w-full grid-cols-2 items-center gap-2 sm:ml-auto sm:flex sm:w-auto sm:flex-nowrap">
          {actions}
        </div>
      )}
    </div>
  );
}
