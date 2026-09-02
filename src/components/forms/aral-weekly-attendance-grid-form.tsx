"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { addDays, formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";
import { cn } from "@/lib/utils";
import { saveAralWeeklyAttendance } from "@/lib/actions/attendance";

/**
 * Weekday and month names are hardcoded rather than taken from `Intl`: this grid
 * renders on the server and hydrates in the browser, and the two do not always
 * ship the same ICU locale data. A mismatch here would be a hydration error on
 * every column header.
 */
const WEEKDAYS_SHORT = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const WEEKDAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `""` is No Class — no `Attendance` row at all, not an absence. */
type CellStatus = "" | "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";

const CELL_LETTER: Record<CellStatus, string> = {
  "": "—",
  PRESENT: "P",
  ABSENT: "A",
  LATE: "L",
  EXCUSED: "E",
};

const CELL_TONE: Record<CellStatus, string> = {
  "": "border-input bg-background text-muted-foreground",
  PRESENT:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  ABSENT:
    "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  EXCUSED:
    "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  // Legacy only: nothing in the app writes LATE any more, but a stored row must
  // still read back correctly rather than silently displaying as No Class.
  LATE: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
};

/** The dot beside each option in the picker. */
const CELL_DOT: Record<CellStatus, string> = {
  "": "bg-muted-foreground/40 text-white",
  PRESENT: "bg-emerald-500 text-white",
  ABSENT: "bg-red-500 text-white",
  EXCUSED: "bg-amber-500 text-white",
  LATE: "bg-sky-500 text-white",
};

/** The statuses a teacher can pick. LATE is deliberately absent. */
const PICKABLE: CellStatus[] = ["", "PRESENT", "ABSENT", "EXCUSED"];

const STATUS_LABEL: Record<CellStatus, string> = {
  "": "No Class",
  PRESENT: "Present",
  ABSENT: "Absent",
  EXCUSED: "Excused",
  LATE: "Late",
};

/**
 * Present needs no reason — that is the rule the picker states out loud, and the
 * server enforces it by storing NULL for a PRESENT cell however the client got
 * there. No Class deletes the row, so it has nowhere to keep one either.
 */
function statusTakesReason(status: CellStatus): boolean {
  return status === "ABSENT" || status === "EXCUSED";
}

const REASON_OPTIONS = [
  "Sick / Illness",
  "Family emergency",
  "Personal reason",
  "No reason given",
] as const;

/** The picker's free-text escape hatch; never stored as the literal label. */
const REASON_OTHER = "Other — Please specify";

const DETAILS_MAX = 200;

/**
 * A stored note is one string, so the picker's two fields are packed into it and
 * unpacked again on load. A known label with details reads `Label — details`;
 * anything unrecognised is treated as free text under `REASON_OTHER`, which is
 * what makes a note written by an older build — a weekly remark, say — survive
 * being opened in the new picker instead of being silently dropped.
 */
function composeNote(reason: string, details: string): string | null {
  const trimmed = details.trim();
  if (!reason || reason === REASON_OTHER) {
    return trimmed.length > 0 ? trimmed : null;
  }
  return trimmed.length > 0 ? `${reason} — ${trimmed}` : reason;
}

function parseNote(note: string): { reason: string; details: string } {
  if (!note) return { reason: "", details: "" };
  for (const option of REASON_OPTIONS) {
    if (note === option) return { reason: option, details: "" };
    if (note.startsWith(`${option} — `)) {
      return { reason: option, details: note.slice(option.length + 3) };
    }
  }
  return { reason: REASON_OTHER, details: note };
}

export type WeeklyAttendanceGridLearner = {
  id: string;
  fullName: string;
  sectionName: string | null;
};

export type WeeklyAttendanceGridExisting = {
  learnerId: string;
  dateKey: string;
  status: string;
  notes: string | null;
};

export type BulkAttendanceAction =
  | { kind: "status"; status: "PRESENT" | "ABSENT" | "EXCUSED" }
  | { kind: "clear" }
  | { kind: "remark"; note: string | null };

export type AralWeeklyAttendanceGridFormHandle = {
  save: () => void;
  applyBulk: (action: BulkAttendanceAction) => void;
};

type RowState = {
  /** Keyed by local `YYYY-MM-DD`. */
  statuses: Record<string, CellStatus>;
  /** The reason for each day, keyed the same way. `""` is no reason. */
  notes: Record<string, string>;
};

type Day = {
  key: string;
  weekday: string;
  monthDay: string;
  aria: string;
  /** Weekend or grade-level holiday: no mark can be stored here. */
  locked: boolean;
  lockReason: string;
};

type Props = {
  gradeId: string;
  /** Monday, `YYYY-MM-DD`. */
  weekStartKey: string;
  learners: WeeklyAttendanceGridLearner[];
  existing: WeeklyAttendanceGridExisting[];
  holidayKeys: string[];
  showSection: boolean;
  readOnly?: boolean;
  onSavePendingChange?: (pending: boolean) => void;
  /** Lets the toolbar's Bulk Actions button show a live count. */
  onSelectionChange?: (count: number) => void;
};

function isCellStatus(value: string): value is Exclude<CellStatus, ""> {
  return (
    value === "PRESENT" ||
    value === "ABSENT" ||
    value === "LATE" ||
    value === "EXCUSED"
  );
}

function buildDays(weekStartKey: string, holidayKeys: string[]): Day[] {
  const holidays = new Set(holidayKeys);
  const start = parseLocalDateKey(weekStartKey);
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(start, i);
    const key = formatLocalDateKey(date);
    const dow = date.getDay();
    const weekend = dow === 0 || dow === 6;
    const holiday = holidays.has(key);
    const monthDay = `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
    return {
      key,
      weekday: WEEKDAYS_SHORT[dow],
      monthDay,
      aria: `${WEEKDAYS_LONG[dow]}, ${monthDay}`,
      locked: weekend || holiday,
      lockReason: holiday ? "Holiday" : weekend ? "No class" : "",
    };
  });
}

function toInitial(
  learners: WeeklyAttendanceGridLearner[],
  existing: WeeklyAttendanceGridExisting[],
  days: Day[]
): Record<string, RowState> {
  const byLearner = new Map<string, WeeklyAttendanceGridExisting[]>();
  for (const row of existing) {
    const list = byLearner.get(row.learnerId);
    if (list) list.push(row);
    else byLearner.set(row.learnerId, [row]);
  }

  const init: Record<string, RowState> = {};
  for (const learner of learners) {
    const statuses: Record<string, CellStatus> = {};
    const notes: Record<string, string> = {};
    for (const day of days) {
      statuses[day.key] = "";
      notes[day.key] = "";
    }
    for (const row of byLearner.get(learner.id) ?? []) {
      if (row.dateKey in statuses && isCellStatus(row.status)) {
        statuses[row.dateKey] = row.status;
        // The reason is per-day now, and belongs to the day it is stored on.
        if (row.notes) notes[row.dateKey] = row.notes;
      }
    }
    init[learner.id] = { statuses, notes };
  }
  return init;
}

function countRow(row: RowState | undefined, days: Day[]) {
  let present = 0;
  let absent = 0;
  let excused = 0;
  let late = 0;
  for (const day of days) {
    switch (row?.statuses[day.key]) {
      case "PRESENT":
        present += 1;
        break;
      case "ABSENT":
        absent += 1;
        break;
      case "EXCUSED":
        excused += 1;
        break;
      case "LATE":
        late += 1;
        break;
      default:
        break;
    }
  }
  const marked = present + late + absent + excused;
  // A late learner attended, so LATE counts toward the rate — but it keeps its
  // own status and is never folded into the Present column.
  const percent = marked > 0 ? Math.round(((present + late) / marked) * 100) : 0;
  return { present, absent, excused, late, marked, percent };
}

export const AralWeeklyAttendanceGridForm = forwardRef<
  AralWeeklyAttendanceGridFormHandle,
  Props
>(function AralWeeklyAttendanceGridForm(
  {
    gradeId,
    weekStartKey,
    learners,
    existing,
    holidayKeys,
    showSection,
    readOnly,
    onSavePendingChange,
    onSelectionChange,
  },
  ref
) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const days = buildDays(weekStartKey, holidayKeys);
  /**
   * What the week looked like when it loaded. Saves send the difference, so an
   * untouched cell is never rewritten — that is what preserves a legacy LATE row
   * and what makes "No changes to save" honest.
   */
  const [initial, setInitial] = useState(() =>
    toInitial(learners, existing, days)
  );
  const [rows, setRows] = useState(initial);
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  /**
   * Enrolling a learner ends in `router.refresh()` (see `enroll-to-aral-dialog`),
   * which lengthens `learners` without remounting this form — the panel keys the
   * grid on the loaded week, not on the roster, so that marks already typed into
   * other rows survive. Both halves above were seeded on first mount, so without
   * this a learner who arrives that way has no entry: the `if (!row)` bails below
   * would reject every edit to its cells and skip it on save, with nothing on
   * screen to say so. Seeding baseline and rows from the same object is what
   * keeps an untouched new row diffing as clean, so it stays "nothing to save".
   */
  const unseeded = learners.filter((learner) => !(learner.id in rows));
  if (unseeded.length > 0) {
    const seeded = toInitial(unseeded, existing, days);
    setInitial((prev) => ({ ...seeded, ...prev }));
    setRows((prev) => ({ ...seeded, ...prev }));
  }

  useEffect(() => {
    onSavePendingChange?.(pending);
  }, [pending, onSavePendingChange]);

  const selectedCount = useMemo(
    () => learners.reduce((n, l) => (selected[l.id] ? n + 1 : n), 0),
    [learners, selected]
  );

  useEffect(() => {
    onSelectionChange?.(selectedCount);
  }, [selectedCount, onSelectionChange]);

  function setCell(
    learnerId: string,
    dateKey: string,
    status: CellStatus,
    note: string
  ) {
    setRows((prev) => {
      const row = prev[learnerId];
      if (!row) return prev;
      return {
        ...prev,
        [learnerId]: {
          statuses: { ...row.statuses, [dateKey]: status },
          // Present and No Class carry no reason, so switching to either drops
          // whatever the previous status had recorded rather than leaving an
          // orphaned explanation attached to the day.
          notes: {
            ...row.notes,
            [dateKey]: statusTakesReason(status) ? note : "",
          },
        },
      };
    });
  }

  const applyBulk = useCallback(
    (action: BulkAttendanceAction) => {
      if (readOnly || pending) return;
      const targets = learners.filter((l) => selected[l.id]);
      if (targets.length === 0) {
        toast("Select at least one learner first");
        return;
      }
      const editable = days.filter((d) => !d.locked);

      setRows((prev) => {
        const next = { ...prev };
        for (const learner of targets) {
          const row = next[learner.id];
          if (!row) continue;
          const statuses = { ...row.statuses };
          const notes = { ...row.notes };
          for (const day of editable) {
            if (action.kind === "status") {
              statuses[day.key] = action.status;
              if (!statusTakesReason(action.status)) notes[day.key] = "";
            } else if (action.kind === "clear") {
              statuses[day.key] = "";
              notes[day.key] = "";
            } else if (statusTakesReason(statuses[day.key])) {
              // A remark explains an absence, so it only lands on days that
              // actually carry one. Present and unmarked days are left alone
              // rather than given a reason that contradicts them.
              notes[day.key] = action.note ?? "";
            }
          }
          next[learner.id] = { statuses, notes };
        }
        return next;
      });

      const n = targets.length;
      const who = `${n} learner${n === 1 ? "" : "s"}`;
      const label =
        action.kind === "status"
          ? `Marked ${who} ${STATUS_LABEL[action.status]}`
          : action.kind === "clear"
            ? `Cleared ${who}`
            : `Remark applied to ${who}`;
      toast.success(`${label}. Save to keep the change.`);
    },
    [readOnly, pending, learners, selected, days]
  );

  const handleSave = useCallback(() => {
    if (readOnly || pending) return;

    const editable = days.filter((d) => !d.locked);

    const cells: {
      learnerId: string;
      date: string;
      status: Exclude<CellStatus, ""> | null;
      notes: string | null;
    }[] = [];
    for (const learner of learners) {
      for (const day of editable) {
        const beforeStatus = initial[learner.id]?.statuses[day.key] ?? "";
        const afterStatus = rows[learner.id]?.statuses[day.key] ?? "";
        const beforeNote = initial[learner.id]?.notes[day.key] ?? "";
        const afterNote = rows[learner.id]?.notes[day.key] ?? "";
        // A reason-only edit is a real edit: the cell travels when either half
        // changed, so re-typing a reason on an unchanged status still saves.
        if (beforeStatus === afterStatus && beforeNote === afterNote) continue;
        cells.push({
          learnerId: learner.id,
          date: day.key,
          status: afterStatus === "" ? null : afterStatus,
          notes: afterNote.length > 0 ? afterNote : null,
        });
      }
    }

    if (cells.length === 0) {
      toast("No changes to save");
      return;
    }

    startTransition(async () => {
      const toastId = toast.loading("Saving weekly attendance…");
      const res = await saveAralWeeklyAttendance({
        gradeId,
        weekStart: weekStartKey,
        cells,
      });
      if (!res.ok) {
        toast.error(res.error, { id: toastId });
        return;
      }

      toast.success("Weekly attendance saved", { id: toastId });
      // Every cell that travelled was accepted, so the baseline becomes what is
      // on screen and the grid is clean again.
      setInitial(rows);
      router.refresh();
    });
  }, [
    readOnly,
    pending,
    days,
    learners,
    initial,
    rows,
    gradeId,
    weekStartKey,
    router,
  ]);

  useImperativeHandle(ref, () => ({ save: handleSave, applyBulk }), [
    handleSave,
    applyBulk,
  ]);

  if (learners.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No ARAL learners match this filter.
      </p>
    );
  }

  const allSelected = learners.every((l) => selected[l.id]);
  const someSelected = !allSelected && learners.some((l) => selected[l.id]);

  const totals = learners.reduce(
    (acc, learner) => {
      const row = countRow(rows[learner.id], days);
      acc.present += row.present;
      acc.absent += row.absent;
      acc.excused += row.excused;
      if (row.marked > 0) {
        acc.percentSum += row.percent;
        acc.marked += 1;
      }
      return acc;
    },
    { present: 0, absent: 0, excused: 0, percentSum: 0, marked: 0 }
  );
  const averagePercent =
    totals.marked > 0 ? Math.round(totals.percentSum / totals.marked) : 0;

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={
                    allSelected ? true : someSelected ? "indeterminate" : false
                  }
                  disabled={readOnly || pending}
                  onCheckedChange={(value) =>
                    setSelected(
                      value === true
                        ? Object.fromEntries(learners.map((l) => [l.id, true]))
                        : {}
                    )
                  }
                  aria-label={
                    allSelected ? "Clear selection" : "Select all learners"
                  }
                />
              </TableHead>
              <TableHead className="w-10">#</TableHead>
              <TableHead className="min-w-[180px]">Learner</TableHead>
              {showSection && <TableHead>Section</TableHead>}
              {days.map((day) => (
                <TableHead key={day.key} className="min-w-[68px] text-center">
                  <span className="block">{day.weekday}</span>
                  <span className="block font-normal normal-case tracking-normal text-muted-foreground">
                    {day.monthDay}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {learners.map((learner, index) => {
              const row = rows[learner.id];
              return (
                <TableRow
                  key={learner.id}
                  data-state={selected[learner.id] ? "selected" : undefined}
                >
                  <TableCell>
                    <Checkbox
                      checked={!!selected[learner.id]}
                      disabled={readOnly || pending}
                      onCheckedChange={(value) =>
                        setSelected((prev) => ({
                          ...prev,
                          [learner.id]: value === true,
                        }))
                      }
                      aria-label={`Select ${learner.fullName}`}
                    />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground tabular-nums">
                    {index + 1}
                  </TableCell>
                  <TableCell className="font-medium">
                    {learner.fullName}
                  </TableCell>
                  {showSection && (
                    <TableCell className="text-sm text-muted-foreground">
                      {learner.sectionName ?? "—"}
                    </TableCell>
                  )}
                  {days.map((day) => {
                    const status = row?.statuses[day.key] ?? "";
                    const note = row?.notes[day.key] ?? "";
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
                          disabled={readOnly || pending}
                          label={`${learner.fullName} attendance for ${day.aria}`}
                          onChange={(nextStatus, nextNote) =>
                            setCell(learner.id, day.key, nextStatus, nextNote)
                          }
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/60 p-4 text-xs text-muted-foreground">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Legend status="PRESENT" label="Present" />
          <Legend status="ABSENT" label="Absent" />
          <Legend status="EXCUSED" label="Excused" />
          <Legend status="" label="No Class" />
        </span>
        <span aria-hidden className="hidden h-4 w-px bg-border sm:block" />
        <span className="rounded-full bg-muted px-2.5 py-1 font-medium text-foreground">
          Summary ({learners.length} learner{learners.length === 1 ? "" : "s"})
        </span>
        <span>
          Total Present:{" "}
          <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {totals.present}
          </span>
        </span>
        <span>
          Total Absent:{" "}
          <span className="font-semibold tabular-nums text-red-600 dark:text-red-400">
            {totals.absent}
          </span>
        </span>
        <span>
          Total Excused:{" "}
          <span className="font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {totals.excused}
          </span>
        </span>
        <span>
          Average Attendance:{" "}
          <span className="font-semibold tabular-nums text-violet-700 dark:text-violet-300">
            {averagePercent} %
          </span>
        </span>
      </div>
    </>
  );
});

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
        <button
          type="button"
          disabled={disabled}
          aria-label={label}
          title={note || undefined}
          className={cn(
            "flex h-8 w-full items-center justify-center gap-1 rounded-md border px-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60",
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
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <div className="p-1">
          <p className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
            Attendance
          </p>
          {PICKABLE.map((option) => (
            <button
              key={option || "none"}
              type="button"
              onClick={() => pick(option)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                status === option && "bg-accent"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
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
            </button>
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
                onChange(status, composeNote(reason, parsed.details) ?? "")
              }
            >
              <SelectTrigger className="h-8 text-sm">
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
              value={parsed.details}
              maxLength={DETAILS_MAX}
              placeholder="Optional details…"
              className="min-h-[64px] text-sm"
              aria-label="Optional details"
              onChange={(e) =>
                onChange(status, composeNote(parsed.reason, e.target.value) ?? "")
              }
            />
            <p className="text-right text-[11px] tabular-nums text-muted-foreground">
              {parsed.details.length}/{DETAILS_MAX}
            </p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The toolbar's Bulk Actions menu. It sits beside Save rather than inside the
 * grid, so the panel owns the button while the grid owns the selection; the two
 * meet at the form's imperative handle.
 */
export function BulkAttendanceActions({
  selectedCount,
  disabled,
  onApply,
}: {
  selectedCount: number;
  disabled?: boolean;
  onApply: (action: BulkAttendanceAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const [remarkOpen, setRemarkOpen] = useState(false);
  const [reason, setReason] = useState<string>(REASON_OPTIONS[0]);
  const [details, setDetails] = useState("");

  function run(action: BulkAttendanceAction) {
    onApply(action);
    setOpen(false);
    setRemarkOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setRemarkOpen(false);
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled}>
          Bulk Actions
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        <div className="border-b border-border/60 px-3 py-2 text-sm font-semibold">
          Bulk Actions
        </div>
        <div className="p-1">
          <BulkItem
            label="Mark as Present (P)"
            onClick={() => run({ kind: "status", status: "PRESENT" })}
          />
          <BulkItem
            label="Mark as Absent (A)"
            onClick={() => run({ kind: "status", status: "ABSENT" })}
          />
          <BulkItem
            label="Mark as Excused (E)"
            onClick={() => run({ kind: "status", status: "EXCUSED" })}
          />
          <BulkItem
            label="Clear Attendance"
            onClick={() => run({ kind: "clear" })}
          />
          <BulkItem
            label="Add Remarks"
            onClick={() => setRemarkOpen((v) => !v)}
          />
        </div>

        {remarkOpen && (
          <div className="space-y-2 border-t border-border/60 p-3">
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger className="h-8 text-sm">
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
              value={details}
              maxLength={DETAILS_MAX}
              placeholder="Optional details…"
              className="min-h-[60px] text-sm"
              aria-label="Bulk remark details"
              onChange={(e) => setDetails(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              className="w-full"
              onClick={() =>
                run({ kind: "remark", note: composeNote(reason, details) })
              }
            >
              Apply remark
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Applies only to days already marked Absent or Excused.
            </p>
          </div>
        )}

        <div className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
          Selected:{" "}
          <span className="font-medium tabular-nums text-foreground">
            {selectedCount}
          </span>{" "}
          learner{selectedCount === 1 ? "" : "s"}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function BulkItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
    >
      {label}
    </button>
  );
}

function Legend({ status, label }: { status: CellStatus; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded border text-[11px] font-semibold",
          CELL_TONE[status]
        )}
        aria-hidden
      >
        {CELL_LETTER[status]}
      </span>
      {label}
    </span>
  );
}
