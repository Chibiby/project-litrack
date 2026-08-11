"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addDays, formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";
import { getMonday } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

type HolidayControl = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
};

type Props = {
  value: string;
  onNavigate: (nextValue: string) => void;
  label: string;
  prevLabel: string;
  nextLabel: string;
  /** When true (weekly nav), step ±7 days and snap picker value to Monday. */
  snapToMonday?: boolean;
  pending?: boolean;
  /** Optional control rendered immediately before Holiday (e.g. Filter). */
  filter?: ReactNode;
  /** Optional holiday toggle rendered after the next button (attendance only). */
  holiday?: HolidayControl;
  /** Right-aligned actions (e.g. Clear / Save on attendance). */
  actions?: ReactNode;
};

export function AralDateNav({
  value,
  onNavigate,
  label,
  prevLabel,
  nextLabel,
  snapToMonday,
  pending,
  filter,
  holiday,
  actions,
}: Props) {
  const current = parseLocalDateKey(value);
  const step = snapToMonday ? 7 : 1;
  const prevValue = formatLocalDateKey(addDays(current, -step));
  const nextValue = formatLocalDateKey(addDays(current, step));

  return (
    <div
      className="flex flex-wrap items-center gap-3 border-b border-border/60 p-4"
      aria-busy={pending || undefined}
    >
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        {label}
        <Input
          type="date"
          value={value}
          className="h-8 w-auto"
          onChange={(e) => {
            const raw = e.target.value;
            if (!raw) return;
            const next = snapToMonday
              ? formatLocalDateKey(getMonday(parseLocalDateKey(raw)))
              : raw;
            onNavigate(next);
          }}
        />
      </label>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={prevLabel}
        title={prevLabel}
        onClick={() => onNavigate(prevValue)}
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={nextLabel}
        title={nextLabel}
        onClick={() => onNavigate(nextValue)}
      >
        <ChevronRight className="h-4 w-4" />
      </Button>
      {filter}
      {holiday && (
        <div className="flex items-center gap-2">
          <Checkbox
            id="attendance-holiday"
            checked={holiday.checked}
            disabled={holiday.disabled || pending}
            onCheckedChange={(v) => holiday.onCheckedChange(v === true)}
          />
          <Label
            htmlFor="attendance-holiday"
            className="cursor-pointer text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
          >
            Holiday
          </Label>
        </div>
      )}
      {actions != null && (
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
