"use client";

import { memo, useState } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  CELL_DOT,
  CELL_LETTER,
  CELL_TONE,
  DETAILS_MAX,
  PICKABLE,
  REASON_OPTIONS,
  REASON_OTHER,
  STATUS_LABEL,
  composeNote,
  parseNote,
  statusTakesReason,
  type CellStatus,
  type Day,
  type RowState,
  type WeeklyAttendanceGridLearner,
} from "@/components/forms/aral-weekly-attendance-grid-shared";

export type AttendanceGridRowProps = {
  learner: WeeklyAttendanceGridLearner;
  index: number;
  showSection: boolean;
  days: Day[];
  rowState: RowState | undefined;
  selected: boolean;
  disabled: boolean;
  onToggleSelect: (learnerId: string, value: boolean) => void;
  onCellChange: (
    learnerId: string,
    dateKey: string,
    status: CellStatus,
    note: string
  ) => void;
  onClearRow: (learnerId: string) => void;
};

/**
 * One learner's row. Memoized so a `setCell` in the parent — which only
 * replaces its own learner's slice of `rows` — leaves every other row's props
 * referentially identical and skips their render, instead of re-rendering the
 * whole grid on every keystroke in a day picker.
 */
function AttendanceGridRowImpl({
  learner,
  index,
  showSection,
  days,
  rowState,
  selected,
  disabled,
  onToggleSelect,
  onCellChange,
  onClearRow,
}: AttendanceGridRowProps) {
  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell>
        <Checkbox
          checked={selected}
          disabled={disabled}
          onCheckedChange={(value) =>
            onToggleSelect(learner.id, value === true)
          }
          aria-label={`Select ${learner.fullName}`}
        />
      </TableCell>
      <TableCell className="text-sm text-muted-foreground tabular-nums">
        {index + 1}
      </TableCell>
      <TableCell
        className={cn(
          "sticky left-0 z-10 font-medium",
          selected ? "bg-muted" : "bg-card"
        )}
      >
        {learner.listingName}
      </TableCell>
      {showSection && (
        <TableCell className="text-sm text-muted-foreground">
          {learner.sectionName ?? "—"}
        </TableCell>
      )}
      {days.map((day) => {
        const status = rowState?.statuses[day.key] ?? "";
        const note = rowState?.notes[day.key] ?? "";
        if (day.locked) {
          return (
            <TableCell key={day.key} className="text-center">
              <span
                className="text-sm text-muted-foreground"
                title={day.lockReason}
              >
                —
              </span>
            </TableCell>
          );
        }
        return (
          <TableCell key={day.key}>
            <AttendanceCellPicker
              status={status}
              note={note}
              disabled={disabled}
              label={`${learner.fullName} attendance for ${day.aria}`}
              onChange={(nextStatus, nextNote) =>
                onCellChange(learner.id, day.key, nextStatus, nextNote)
              }
            />
          </TableCell>
        );
      })}
      <TableCell className="text-center">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={`Clear ${learner.fullName}'s week`}
          onClick={() => onClearRow(learner.id)}
        >
          <Eraser className="h-4 w-4" aria-hidden />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export const AttendanceGridRow = memo(AttendanceGridRowImpl);

/**
 * One day cell. A native `<select>` cannot hold a reason, so this is a popover:
 * status on top, and — only for the two statuses that take one — a reason below.
 * The trigger keeps the letter and tone the grid has always used, so a week
 * still reads at a glance without opening anything.
 */
function AttendanceCellPicker({
  status,
  note,
  disabled,
  label,
  onChange,
}: {
  status: CellStatus;
  note: string;
  disabled?: boolean;
  label: string;
  onChange: (status: CellStatus, note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const parsed = parseNote(note);

  // `note` is always the trimmed, composed string (composeNote trims before
  // storing), so the textarea can't use it directly as `value` — a trailing
  // space typed mid-word would vanish on every keystroke. Keep the raw,
  // untrimmed details the teacher is typing in local state instead, and only
  // resync it from the parsed note when the cell moves to a different
  // status or reason (derived during render, not an effect, so there is no
  // extra tick where the two disagree).
  const cellKey = `${status}|${parsed.reason}`;
  const [prevCellKey, setPrevCellKey] = useState(cellKey);
  const [rawDetails, setRawDetails] = useState(parsed.details);
  if (prevCellKey !== cellKey) {
    setPrevCellKey(cellKey);
    setRawDetails(parsed.details);
  }

  function pick(next: CellStatus) {
    if (!statusTakesReason(next)) {
      onChange(next, "");
      setOpen(false);
      return;
    }
    // Keep whatever reason the day already carried when moving between the two
    // statuses that take one, so switching Absent -> Excused does not discard
    // the explanation the teacher already typed. The popover stays open so the
    // reason fields below can be filled in.
    onChange(next, note);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          aria-label={label}
          title={note || undefined}
          className={cn(
            "flex h-11 w-full items-center justify-center gap-1 rounded-md border px-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60 lg:h-8",
            CELL_TONE[status]
          )}
        >
          {CELL_LETTER[status]}
          {note && statusTakesReason(status) && (
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70"
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="p-1">
          <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
            Attendance
          </p>
          {PICKABLE.map((option) => (
            <Button
              key={option || "none"}
              type="button"
              variant="ghost"
              onClick={() => pick(option)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                status === option && "bg-accent"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  CELL_DOT[option]
                )}
              >
                {CELL_LETTER[option]}
              </span>
              <span className="min-w-0">
                <span className="block font-medium">
                  {STATUS_LABEL[option]}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {statusTakesReason(option)
                    ? "Select reason"
                    : "No remarks required"}
                </span>
              </span>
            </Button>
          ))}
        </div>

        {statusTakesReason(status) && (
          <div className="space-y-2 border-t border-border/60 p-3">
            <p className="text-xs font-semibold text-muted-foreground">
              Reason / Remarks
            </p>
            <Select
              value={parsed.reason || undefined}
              onValueChange={(reason) =>
                onChange(status, composeNote(reason, rawDetails) ?? "")
              }
            >
              <SelectTrigger className="h-11 text-sm lg:h-8">
                <SelectValue placeholder="Select reason" />
              </SelectTrigger>
              <SelectContent>
                {REASON_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
                <SelectItem value={REASON_OTHER}>{REASON_OTHER}</SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              value={rawDetails}
              maxLength={DETAILS_MAX}
              placeholder="Optional details…"
              className="min-h-[64px] text-sm"
              aria-label="Optional details"
              onChange={(e) => {
                setRawDetails(e.target.value);
                onChange(status, composeNote(parsed.reason, e.target.value) ?? "");
              }}
            />
            <p className="text-right text-xs tabular-nums text-muted-foreground">
              {rawDetails.length}/{DETAILS_MAX}
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
