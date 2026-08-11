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
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { bulkMarkAttendance } from "@/lib/actions/attendance";

const STATUSES = ["PRESENT", "ABSENT", "EXCUSED"] as const;
type GridStatus = (typeof STATUSES)[number];

const STATUS_LABELS: Record<GridStatus, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  EXCUSED: "Excused",
};

export type AttendanceGridLearner = {
  id: string;
  fullName: string;
  sectionName: string | null;
};

export type AttendanceGridExisting = {
  learnerId: string;
  status: string;
  notes: string | null;
};

export type AralAttendanceGridFormHandle = {
  clear: () => void;
  save: () => void;
};

type RowState = {
  status: GridStatus | "";
  notes: string;
};

type Props = {
  dateKey: string;
  learners: AttendanceGridLearner[];
  existing: AttendanceGridExisting[];
  showSection?: boolean;
  readOnly?: boolean;
  isHoliday?: boolean;
  onSavePendingChange?: (pending: boolean) => void;
};

function toInitial(
  learners: AttendanceGridLearner[],
  existing: AttendanceGridExisting[]
): Record<string, RowState> {
  const byId = new Map(existing.map((e) => [e.learnerId, e]));
  const init: Record<string, RowState> = {};
  for (const l of learners) {
    const row = byId.get(l.id);
    const status =
      row && STATUSES.includes(row.status as GridStatus)
        ? (row.status as GridStatus)
        : "";
    init[l.id] = { status, notes: row?.notes ?? "" };
  }
  return init;
}

export const AralAttendanceGridForm = forwardRef<
  AralAttendanceGridFormHandle,
  Props
>(function AralAttendanceGridForm(
  {
    dateKey,
    learners,
    existing,
    showSection,
    readOnly,
    isHoliday,
    onSavePendingChange,
  },
  ref
) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState(() => toInitial(learners, existing));

  const editingLocked = Boolean(readOnly || pending || isHoliday);

  useEffect(() => {
    onSavePendingChange?.(pending);
  }, [pending, onSavePendingChange]);

  function setStatus(learnerId: string, status: GridStatus, checked: boolean) {
    setRows((prev) => ({
      ...prev,
      [learnerId]: {
        ...prev[learnerId],
        // Unchecking the selected status clears the row; checking sets it.
        status: checked ? status : "",
      },
    }));
  }

  function selectAll(status: GridStatus, checked: boolean) {
    if (editingLocked) return;
    setRows((prev) => {
      const next = { ...prev };
      for (const l of learners) {
        if (checked) {
          next[l.id] = { ...next[l.id], status };
        } else if (next[l.id]?.status === status) {
          next[l.id] = { ...next[l.id], status: "" };
        }
      }
      return next;
    });
  }

  function columnCheckState(status: GridStatus): boolean | "indeterminate" {
    const total = learners.length;
    if (total === 0) return false;
    let matchCount = 0;
    for (const l of learners) {
      if (rows[l.id]?.status === status) matchCount += 1;
    }
    // Fully checked only when every visible learner has this status.
    if (matchCount === total) return true;
    // Some but not all → indeterminate (never looks fully checked).
    if (matchCount > 0) return "indeterminate";
    return false;
  }

  function setNotes(learnerId: string, notes: string) {
    setRows((prev) => ({
      ...prev,
      [learnerId]: { ...prev[learnerId], notes },
    }));
  }

  /** Client-only: clears visible statuses/remarks. Does not delete DB records. */
  const handleClear = useCallback(() => {
    if (readOnly || pending || isHoliday) return;
    setRows((prev) => {
      const next = { ...prev };
      for (const l of learners) {
        next[l.id] = { status: "", notes: "" };
      }
      return next;
    });
  }, [readOnly, pending, isHoliday, learners]);

  const handleSave = useCallback(() => {
    if (isHoliday) {
      toast.error("This day is marked as a holiday — attendance is not editable");
      return;
    }
    if (readOnly || pending) return;

    const entries = learners
      .map((l) => {
        const row = rows[l.id];
        if (!row?.status) return null;
        return {
          learnerId: l.id,
          status: row.status,
          notes: row.notes.trim() || undefined,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    if (entries.length === 0) {
      toast.error("Mark at least one learner before saving");
      return;
    }

    startTransition(async () => {
      const toastId = toast.loading("Saving attendance…");
      const res = await bulkMarkAttendance({ date: dateKey, entries });
      if (res.ok) {
        toast.success(
          `Saved attendance for ${res.data?.upserted ?? entries.length} learner${
            (res.data?.upserted ?? entries.length) === 1 ? "" : "s"
          }`,
          { id: toastId }
        );
        router.refresh();
      } else {
        toast.error(res.error, { id: toastId });
      }
    });
  }, [isHoliday, readOnly, pending, learners, rows, dateKey, router]);

  useImperativeHandle(
    ref,
    () => ({
      clear: handleClear,
      save: handleSave,
    }),
    [handleClear, handleSave]
  );

  if (learners.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No ARAL learners match this filter.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {isHoliday && (
        <div className="mx-4 mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
          This day is marked as a holiday. Individual attendance marking is
          disabled.
        </div>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[160px]">Learner</TableHead>
              {showSection && <TableHead>Section</TableHead>}
              {STATUSES.map((status) => (
                <TableHead key={status} className="text-center">
                  <div className="flex items-center justify-center gap-1.5 py-1">
                    {!readOnly && (
                      <Checkbox
                        checked={columnCheckState(status)}
                        disabled={editingLocked}
                        onCheckedChange={(v) =>
                          selectAll(status, v === true)
                        }
                        aria-label={`Select all ${STATUS_LABELS[status].toLowerCase()}`}
                        className="rounded-[2px]"
                      />
                    )}
                    <span>{STATUS_LABELS[status]}</span>
                  </div>
                </TableHead>
              ))}
              <TableHead className="min-w-[180px]">
                Remarks{" "}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {learners.map((l) => {
              const row = rows[l.id] ?? { status: "" as const, notes: "" };
              return (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.fullName}</TableCell>
                  {showSection && (
                    <TableCell className="text-sm text-muted-foreground">
                      {l.sectionName ?? "—"}
                    </TableCell>
                  )}
                  {STATUSES.map((status) => (
                    <TableCell key={status} className="text-center">
                      <Checkbox
                        checked={row.status === status}
                        disabled={editingLocked}
                        onCheckedChange={(v) =>
                          setStatus(l.id, status, v === true)
                        }
                        aria-label={`${l.fullName} ${STATUS_LABELS[status].toLowerCase()}`}
                        className="mx-auto rounded-[2px]"
                      />
                    </TableCell>
                  ))}
                  <TableCell>
                    <Input
                      value={row.notes}
                      disabled={editingLocked}
                      onChange={(e) => setNotes(l.id, e.target.value)}
                      className="h-8"
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
});
