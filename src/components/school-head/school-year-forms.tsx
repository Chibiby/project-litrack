"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import { CalendarPlus, CalendarRange, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Callout } from "@/components/ui/callout";
import { ConfirmAction } from "@/components/confirm-action";
import {
  createDivisionSchoolYear,
  deleteSchoolYear,
  setActiveSchoolYear,
  setSchoolYearMonths,
} from "@/lib/actions/school-year";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";
import {
  listOptimisticReducer,
  runOptimistic,
  settleActionResult,
  type ListOptimisticOp,
} from "@/lib/ui/optimistic";

export type SchoolYearListItem = {
  id: string;
  label: string;
  /** `YYYY-MM` */
  startMonth: string;
  /** `YYYY-MM`, or null while the School Head has not set it. */
  endMonth: string | null;
  isActive: boolean;
  /** Records pointing at this year. Drives the edit note and whether removal is offered. */
  enrollmentCount: number;
  termGradeCount: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-06` → "Jun 2026" */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}` : key;
}

/** "Jun 2026 – Apr 2027", or "Jun 2026 – end not set" */
export function monthRangeLabel(startMonth: string, endMonth: string | null): string {
  return `${monthLabel(startMonth)} – ${endMonth ? monthLabel(endMonth) : "end not set"}`;
}

type MonthDraft = { startMonth: string; endMonth: string };

/** Start month (required) and end month (optional), shared by both dialogs. */
function MonthFields({
  draft,
  onChange,
  disabled,
  idPrefix,
}: {
  draft: MonthDraft;
  onChange: (next: MonthDraft) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-start`}>Start month</Label>
        <Input
          id={`${idPrefix}-start`}
          name="startMonth"
          type="month"
          value={draft.startMonth}
          onChange={(e) => onChange({ ...draft, startMonth: e.target.value })}
          required
          disabled={disabled}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-end`}>
          End month <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={`${idPrefix}-end`}
          name="endMonth"
          type="month"
          value={draft.endMonth}
          min={draft.startMonth || undefined}
          onChange={(e) => onChange({ ...draft, endMonth: e.target.value })}
          disabled={disabled}
          aria-describedby={`${idPrefix}-end-hint`}
        />
        <p id={`${idPrefix}-end-hint`} className="text-xs text-muted-foreground">
          Leave empty if not decided yet.
        </p>
      </div>
    </div>
  );
}

/**
 * Division Admin: one school year for every school at once. Each School Head then
 * adjusts the months for their own school.
 */
export function CreateDivisionSchoolYearDialog({ suggestedLabel }: { suggestedLabel: string }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(suggestedLabel);
  const [months, setMonths] = useState<MonthDraft>({ startMonth: "", endMonth: "" });
  const [setActive, setSetActive] = useState(false);
  const [pending, startTransition] = useTransition();
  const idPrefix = useId();

  const openDialog = (next: boolean) => {
    setOpen(next);
    if (next) {
      setLabel(suggestedLabel);
      const startYear = suggestedLabel.slice(0, 4);
      setMonths({ startMonth: startYear ? `${startYear}-06` : "", endMonth: "" });
      setSetActive(false);
    }
  };

  const submit = () =>
    startTransition(async () => {
      const fd = new FormData();
      fd.set("label", label);
      fd.set("startMonth", months.startMonth);
      fd.set("endMonth", months.endMonth);
      if (setActive) fd.set("setActive", "true");
      const res = await callAction(() => createDivisionSchoolYear(fd));
      if (!res.ok) {
        toastFailure(res);
        return;
      }
      toast.success(
        `${label} created for ${res.created} school${res.created === 1 ? "" : "s"}` +
          (res.skipped > 0 ? ` (${res.skipped} already had it)` : "")
      );
      setOpen(false);
    });

  return (
    <Dialog open={open} onOpenChange={openDialog}>
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <Plus className="h-4 w-4" aria-hidden />
          Add school year
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-primary" aria-hidden />
            Add school year for every school
          </DialogTitle>
          <DialogDescription>
            Every school gets this year. School Heads can change the start and end
            month for their own school.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`${idPrefix}-label`}>Label</Label>
            <Input
              id={`${idPrefix}-label`}
              name="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="2027-2028"
              inputMode="numeric"
              required
              disabled={pending}
              aria-describedby={`${idPrefix}-label-hint`}
            />
            <p id={`${idPrefix}-label-hint`} className="text-xs text-muted-foreground">
              Format YYYY-YYYY, consecutive years.
            </p>
          </div>

          <MonthFields draft={months} onChange={setMonths} disabled={pending} idPrefix={idPrefix} />

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={setActive}
              onChange={(e) => setSetActive(e.target.checked)}
              className="mt-0.5 rounded border"
              disabled={pending}
            />
            <span>
              Make it the active year at every school
              <span className="block text-xs text-muted-foreground">
                Learners stay enrolled in the year they are in now. Leave this off
                until learners are ready to move up.
              </span>
            </span>
          </label>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} loadingText="Creating…">
              Create for every school
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** School Head: set the start month and, optionally, the end month. */
export function SetMonthsDialog({
  year,
  onSave,
}: {
  year: SchoolYearListItem;
  onSave: (draft: MonthDraft) => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MonthDraft>({
    startMonth: year.startMonth,
    endMonth: year.endMonth ?? "",
  });
  const [pending, startTransition] = useTransition();
  const idPrefix = useId();
  const recordCount = year.enrollmentCount + year.termGradeCount;

  const openDialog = (next: boolean) => {
    setOpen(next);
    if (next) setDraft({ startMonth: year.startMonth, endMonth: year.endMonth ?? "" });
  };

  return (
    <Dialog open={open} onOpenChange={openDialog}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <CalendarRange className="h-4 w-4" aria-hidden />
          Set months
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Months for {year.label}</DialogTitle>
          <DialogDescription>
            When this school year starts and ends at your school.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            startTransition(async () => {
              await onSave(draft);
              setOpen(false);
            });
          }}
        >
          <MonthFields draft={draft} onChange={setDraft} disabled={pending} idPrefix={idPrefix} />
          {recordCount > 0 ? (
            <Callout title="Learners stay where they are">
              Changing the months does not move any enrolment or grade. It only
              changes the range reports and term windows use.
            </Callout>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} loadingText="Saving…">
              Save months
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Only asks to switch; the confirmation lives in `SchoolYearsList`, outside the
 * row, because the optimistic swap re-renders this row and would close a
 * dialog mounted inside it before the server has answered.
 */
export function SetActiveYearButton({
  disabled,
  pending,
  onRequest,
}: {
  disabled?: boolean;
  pending?: boolean;
  onRequest: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={disabled}
      loading={pending}
      loadingText="Setting active…"
      onClick={onRequest}
    >
      Set active
    </Button>
  );
}

/**
 * A school's years. School Heads may set months only; a Division Admin viewing
 * the school may also switch the active year and remove an empty one.
 */
export function SchoolYearsList({
  years,
  canSetMonths = false,
  canManage = false,
}: {
  years: SchoolYearListItem[];
  canSetMonths?: boolean;
  canManage?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [activating, setActivating] = useState<{
    id: string;
    label: string;
    currentLabel: string | null;
  } | null>(null);
  const [optimisticYears, dispatchOptimistic] = useOptimistic(
    years,
    (state: SchoolYearListItem[], op: ListOptimisticOp<SchoolYearListItem>) =>
      listOptimisticReducer(state, op)
  );

  const setActive = (schoolYearId: string) =>
    runOptimistic(startTransition, async () => {
      dispatchOptimistic({ type: "setExclusiveFlag", id: schoolYearId, flag: "isActive" });
      const fd = new FormData();
      fd.set("schoolYearId", schoolYearId);
      const res = await setActiveSchoolYear(fd);
      await settleActionResult(res, "Active school year updated");
    });

  const saveMonths = (schoolYearId: string, draft: MonthDraft) =>
    runOptimistic(startTransition, async () => {
      dispatchOptimistic({
        type: "patch",
        id: schoolYearId,
        patch: { startMonth: draft.startMonth, endMonth: draft.endMonth || null },
      });
      const fd = new FormData();
      fd.set("schoolYearId", schoolYearId);
      fd.set("startMonth", draft.startMonth);
      fd.set("endMonth", draft.endMonth);
      const res = await setSchoolYearMonths(fd);
      await settleActionResult(res, "School year months saved");
    });

  const removeYear = (schoolYearId: string) =>
    runOptimistic(startTransition, async () => {
      dispatchOptimistic({ type: "remove", id: schoolYearId });
      const fd = new FormData();
      fd.set("schoolYearId", schoolYearId);
      const res = await deleteSchoolYear(fd);
      await settleActionResult(res, "School year deleted");
    });

  return (
    <>
      <ConfirmAction
        open={activating !== null}
        onOpenChange={(next) => {
          if (!next) setActivating(null);
        }}
        title={`Make ${activating?.label ?? ""} active?`}
        description={`${activating?.currentLabel ? `${activating.currentLabel} stops being active. ` : ""}New enrolments go to ${activating?.label ?? ""}. You can switch back.`}
        confirmLabel={`Make ${activating?.label ?? ""} active`}
        variant="default"
        onConfirm={() => (activating ? setActive(activating.id) : undefined)}
      />
      <ul className="space-y-3">
        {optimisticYears.map((y) => {
          const recordCount = y.enrollmentCount + y.termGradeCount;
          // Removal exists for the duplicate-year mistake only.
          const removable = canManage && !y.isActive && recordCount === 0;

          return (
            <li
              key={y.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{y.label}</span>
                  {y.isActive ? <Badge>Active</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {monthRangeLabel(y.startMonth, y.endMonth)}
                  {y.enrollmentCount > 0
                    ? ` · ${y.enrollmentCount.toLocaleString()} enrolled`
                    : " · no records yet"}
                </p>
              </div>

              {canSetMonths || canManage ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {canManage && !y.isActive ? (
                    <SetActiveYearButton
                      pending={pending}
                      onRequest={() =>
                        setActivating({
                          id: y.id,
                          label: y.label,
                          currentLabel: optimisticYears.find((o) => o.isActive)?.label ?? null,
                        })
                      }
                    />
                  ) : null}

                  {canSetMonths ? (
                    <SetMonthsDialog year={y} onSave={(draft) => saveMonths(y.id, draft)} />
                  ) : null}

                  {removable ? (
                    <ConfirmAction
                      title={`Delete ${y.label} permanently?`}
                      description="Nothing is recorded against this year yet, so deleting it loses no data. This cannot be undone."
                      confirmLabel="Delete permanently"
                      variant="destructive"
                      disabled={pending}
                      trigger={
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          disabled={pending}
                          aria-label={`Delete ${y.label} permanently`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      }
                      onConfirm={() => removeYear(y.id)}
                    />
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
