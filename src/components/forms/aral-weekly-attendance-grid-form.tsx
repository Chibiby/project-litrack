"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
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

/** The statuses a teacher can pick. LATE is deliberately absent. */
const PICKABLE: CellStatus[] = ["", "PRESENT", "ABSENT", "EXCUSED"];

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

export type AralWeeklyAttendanceGridFormHandle = {
  save: () => void;
};

type RowState = {
  /** Keyed by local `YYYY-MM-DD`. */
  statuses: Record<string, CellStatus>;
  notes: string;
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
    for (const day of days) statuses[day.key] = "";
    let notes = "";
    for (const row of byLearner.get(learner.id) ?? []) {
      if (row.dateKey in statuses && isCellStatus(row.status)) {
        statuses[row.dateKey] = row.status;
      }
      // The remark is weekly: it lives on every marked day of the week, so the
      // first one found is the week's remark.
      if (!notes && row.notes) notes = row.notes;
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

  function setStatus(learnerId: string, dateKey: string, status: CellStatus) {
    setRows((prev) => {
      const row = prev[learnerId];
      if (!row) return prev;
      return {
        ...prev,
        [learnerId]: {
          ...row,
          statuses: { ...row.statuses, [dateKey]: status },
        },
      };
    });
  }

  function setNotes(learnerId: string, notes: string) {
    setRows((prev) => {
      const row = prev[learnerId];
      if (!row) return prev;
      return { ...prev, [learnerId]: { ...row, notes } };
    });
  }

  const handleSave = useCallback(() => {
    if (readOnly || pending) return;

    const editable = days.filter((d) => !d.locked);

    const cells: {
      learnerId: string;
      date: string;
      status: Exclude<CellStatus, ""> | null;
    }[] = [];
    for (const learner of learners) {
      for (const day of editable) {
        const before = initial[learner.id]?.statuses[day.key] ?? "";
        const after = rows[learner.id]?.statuses[day.key] ?? "";
        if (before === after) continue;
        cells.push({
          learnerId: learner.id,
          date: day.key,
          status: after === "" ? null : after,
        });
      }
    }

    const remarks = learners
      .filter((learner) => {
        const before = (initial[learner.id]?.notes ?? "").trim();
        const after = (rows[learner.id]?.notes ?? "").trim();
        return before !== after;
      })
      .map((learner) => ({
        learnerId: learner.id,
        notes: (rows[learner.id]?.notes ?? "").trim(),
      }));

    if (cells.length === 0 && remarks.length === 0) {
      toast("No changes to save");
      return;
    }

    startTransition(async () => {
      const toastId = toast.loading("Saving weekly attendance…");
      const res = await saveAralWeeklyAttendance({
        gradeId,
        weekStart: weekStartKey,
        cells,
        remarks,
      });
      if (!res.ok) {
        toast.error(res.error, { id: toastId });
        return;
      }

      const skipped = res.data?.remarksSkipped ?? 0;
      toast.success(
        skipped > 0
          ? `Saved. ${skipped} remark${skipped === 1 ? "" : "s"} need at least one marked day in this week.`
          : "Weekly attendance saved",
        { id: toastId }
      );

      // The grid is clean again — except for a remark the server could not
      // store. Leaving that one dirty means the next save retries it once the
      // learner has a marked day, instead of stranding it in the input.
      setInitial(() => {
        const next: Record<string, RowState> = {};
        for (const learner of learners) {
          const row = rows[learner.id];
          if (!row) continue;
          const stillUnmarked =
            countRow(row, days).marked === 0 &&
            remarks.some((r) => r.learnerId === learner.id);
          next[learner.id] = stillUnmarked
            ? { ...row, notes: initial[learner.id]?.notes ?? "" }
            : row;
        }
        return next;
      });
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

  useImperativeHandle(ref, () => ({ save: handleSave }), [handleSave]);

  if (learners.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No ARAL learners match this filter.
      </p>
    );
  }

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
              <TableHead className="text-center">Present</TableHead>
              <TableHead className="text-center">Absent</TableHead>
              <TableHead className="text-center">Excused</TableHead>
              <TableHead className="text-center">Attendance %</TableHead>
              <TableHead className="min-w-[180px]">Remarks (optional)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {learners.map((learner, index) => {
              const row = rows[learner.id];
              const counts = countRow(row, days);
              return (
                <TableRow key={learner.id}>
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
                        <select
                          className={cn(
                            "h-8 w-full rounded-md border px-2 text-center text-sm font-semibold",
                            CELL_TONE[status]
                          )}
                          value={status}
                          disabled={readOnly || pending}
                          onChange={(e) =>
                            setStatus(
                              learner.id,
                              day.key,
                              e.target.value as CellStatus
                            )
                          }
                          aria-label={`${learner.fullName} attendance for ${day.aria}`}
                        >
                          {PICKABLE.map((option) => (
                            <option key={option || "none"} value={option}>
                              {CELL_LETTER[option]}
                            </option>
                          ))}
                          {status === "LATE" && (
                            // Only rendered where a legacy row already holds it,
                            // so the stored value displays and cannot be picked.
                            <option value="LATE" disabled>
                              {CELL_LETTER.LATE}
                            </option>
                          )}
                        </select>
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-center text-sm font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                    {counts.present}
                  </TableCell>
                  <TableCell className="text-center text-sm font-medium tabular-nums text-red-600 dark:text-red-400">
                    {counts.absent}
                  </TableCell>
                  <TableCell className="text-center text-sm font-medium tabular-nums text-amber-600 dark:text-amber-400">
                    {counts.excused}
                  </TableCell>
                  <TableCell className="text-center text-sm font-semibold tabular-nums text-violet-700 dark:text-violet-300">
                    {counts.percent} %
                  </TableCell>
                  <TableCell>
                    <Input
                      value={row?.notes ?? ""}
                      disabled={readOnly || pending}
                      onChange={(e) => setNotes(learner.id, e.target.value)}
                      placeholder="Add remarks..."
                      className="h-8"
                      aria-label={`${learner.fullName} weekly remarks`}
                    />
                  </TableCell>
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
