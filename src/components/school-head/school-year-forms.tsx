"use client";

import { useId, useOptimistic, useState, useTransition } from "react";
import { CalendarPlus, Pencil, Plus, Trash2 } from "lucide-react";
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
  createSchoolYear,
  deleteSchoolYear,
  setActiveSchoolYear,
  updateSchoolYear,
} from "@/lib/actions/school-year";
import {
  listOptimisticReducer,
  runOptimistic,
  settleActionResult,
  type ListOptimisticOp,
} from "@/lib/ui/optimistic";

export type SchoolYearListItem = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  /**
   * Records pointing at this year. Drives both the edit warning and whether
   * removal is offered at all.
   */
  enrollmentCount: number;
  termGradeCount: number;
};

type YearDraft = Pick<SchoolYearListItem, "label" | "startDate" | "endDate">;

const EMPTY_DRAFT: YearDraft = { label: "", startDate: "", endDate: "" };

/**
 * Suggests 2026-2027 from an existing 2025-2026 so the common case — next year —
 * is one click rather than a hand-typed label that has to pass the
 * consecutive-years check.
 */
function suggestNextLabel(years: SchoolYearListItem[]): string {
  const startYears = years
    .map((y) => Number(y.label.slice(0, 4)))
    .filter((n) => Number.isFinite(n));
  if (startYears.length === 0) return "";
  const next = Math.max(...startYears) + 1;
  return `${next}-${next + 1}`;
}

/**
 * The one field set behind both "Add school year" and the per-row pencil.
 *
 * Shared rather than duplicated because create and edit validate identically —
 * `createSchoolYearSchema` and `updateSchoolYearSchema` are the same field rules
 * with a different id — and two copies of this markup is how the edit path ends
 * up missing a hint that the create path has.
 */
function SchoolYearFields({
  draft,
  onChange,
  disabled,
  idPrefix,
}: {
  draft: YearDraft;
  onChange: (next: YearDraft) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-label`}>Label</Label>
        <Input
          id={`${idPrefix}-label`}
          name="label"
          value={draft.label}
          onChange={(e) => onChange({ ...draft, label: e.target.value })}
          placeholder="2025-2026"
          inputMode="numeric"
          required
          disabled={disabled}
          aria-describedby={`${idPrefix}-label-hint`}
        />
        <p id={`${idPrefix}-label-hint`} className="text-xs text-muted-foreground">
          Format YYYY-YYYY, consecutive years.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-startDate`}>Start date</Label>
          <Input
            id={`${idPrefix}-startDate`}
            name="startDate"
            type="date"
            value={draft.startDate}
            onChange={(e) => onChange({ ...draft, startDate: e.target.value })}
            required
            disabled={disabled}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-endDate`}>End date</Label>
          <Input
            id={`${idPrefix}-endDate`}
            name="endDate"
            type="date"
            value={draft.endDate}
            onChange={(e) => onChange({ ...draft, endDate: e.target.value })}
            required
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Add school year — a header button rather than a card sitting open above the
 * list. A school creates roughly one of these a year, so the form does not earn
 * permanent space, and the list it used to push below the fold is the thing heads
 * actually come here to read.
 */
export function CreateSchoolYearDialog({
  existingYears,
}: {
  existingYears: SchoolYearListItem[];
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<YearDraft>(EMPTY_DRAFT);
  const [setActive, setSetActive] = useState(false);
  const [pending, startTransition] = useTransition();
  const idPrefix = useId();

  const hasActive = existingYears.some((y) => y.isActive);
  const suggestion = suggestNextLabel(existingYears);

  const openDialog = (next: boolean) => {
    setOpen(next);
    if (next) {
      setDraft(EMPTY_DRAFT);
      // The first year at a school should be the active one; there is nothing
      // else for learners to enrol against.
      setSetActive(!hasActive);
    }
  };

  const submit = () =>
    startTransition(async () => {
      const fd = new FormData();
      fd.set("label", draft.label);
      fd.set("startDate", draft.startDate);
      fd.set("endDate", draft.endDate);
      if (setActive) fd.set("setActive", "true");
      const res = await createSchoolYear(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("School year created");
      setOpen(false);
    });

  return (
    <Dialog open={open} onOpenChange={openDialog}>
      <DialogTrigger asChild>
        <Button type="button" size="sm">
          <Plus className="h-4 w-4" />
          Add school year
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="h-5 w-5 text-primary" aria-hidden />
            Add school year
          </DialogTitle>
          <DialogDescription>
            Learners are enrolled against the active year. You can correct any of
            these details later.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <SchoolYearFields
            draft={draft}
            onChange={setDraft}
            disabled={pending}
            idPrefix={idPrefix}
          />

          {suggestion && draft.label !== suggestion ? (
            <Button
              type="button"
              variant="link"
              // Inline text beside a field, so it keeps its own height and sits
              // flush left rather than taking the primitive's button box.
              className="h-auto justify-start p-0 text-xs font-medium underline-offset-2"
              onClick={() => setDraft({ ...draft, label: suggestion })}
              disabled={pending}
            >
              Use {suggestion}
            </Button>
          ) : null}

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={setActive}
              onChange={(e) => setSetActive(e.target.checked)}
              className="mt-0.5 rounded border"
              disabled={pending}
            />
            <span>
              Set as active school year
              {hasActive ? (
                <span className="block text-xs text-muted-foreground">
                  This will deactivate the current active year.
                </span>
              ) : null}
            </span>
          </label>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" loading={pending} loadingText="Creating…">
              Create school year
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Correct a year in place.
 *
 * The warning is the important part here. Dates stay editable once learners are
 * enrolled — locking them would freeze a typo permanently, since the first
 * enrolment lands minutes after the year is created — but enrolments point at
 * this year by id and are never re-dated, so the copy has to say plainly that
 * widening the range moves nobody.
 */
export function EditSchoolYearDialog({
  year,
  onSave,
}: {
  year: SchoolYearListItem;
  onSave?: (draft: YearDraft) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<YearDraft>(year);
  const [pending, startTransition] = useTransition();
  const idPrefix = useId();

  const recordCount = year.enrollmentCount + year.termGradeCount;

  const openDialog = (next: boolean) => {
    setOpen(next);
    // Reset from the row on open, so a cancelled edit does not bleed into the
    // next one and an optimistic patch from the list is picked up.
    if (next) {
      setDraft({
        label: year.label,
        startDate: year.startDate,
        endDate: year.endDate,
      });
    }
  };

  const runStandalone = () =>
    runOptimistic(startTransition, async () => {
      const fd = new FormData();
      fd.set("schoolYearId", year.id);
      fd.set("label", draft.label);
      fd.set("startDate", draft.startDate);
      fd.set("endDate", draft.endDate);
      const res = await updateSchoolYear(fd);
      await settleActionResult(res, "School year updated");
    });

  const submit = () => {
    const handle = onSave ? () => onSave(draft) : runStandalone;
    void Promise.resolve(handle())
      .then(() => setOpen(false))
      .catch(() => {
        /* toast already shown; dialog stays open so the value can be fixed */
      });
  };

  return (
    <Dialog open={open} onOpenChange={openDialog}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`Edit ${year.label}`}
        >
          <Pencil className="h-4 w-4" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" aria-hidden />
            Edit {year.label}
          </DialogTitle>
          <DialogDescription>
            Fix a mistyped label or a wrong date range. This does not change which
            year is active.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <SchoolYearFields
            draft={draft}
            onChange={setDraft}
            disabled={pending}
            idPrefix={idPrefix}
          />

          {recordCount > 0 ? (
            <Callout title="This year already has records">
              {year.enrollmentCount > 0
                ? `${year.enrollmentCount} enrolment${year.enrollmentCount === 1 ? "" : "s"}`
                : null}
              {year.enrollmentCount > 0 && year.termGradeCount > 0 ? " and " : null}
              {year.termGradeCount > 0
                ? `${year.termGradeCount} grade record${year.termGradeCount === 1 ? "" : "s"}`
                : null}{" "}
              {recordCount === 1 ? "is" : "are"} recorded against it. Changing the
              dates does not move them — it only corrects the range shown in
              reports.
            </Callout>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" loading={pending} loadingText="Saving…">
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SetActiveYearButton({
  schoolYearId,
  disabled,
  pending,
  onSetActive,
}: {
  schoolYearId: string;
  disabled?: boolean;
  pending?: boolean;
  onSetActive?: () => void | Promise<void>;
}) {
  const [localPending, startTransition] = useTransition();
  const isPending = pending ?? localPending;

  const runStandalone = () =>
    runOptimistic(startTransition, async () => {
      const fd = new FormData();
      fd.set("schoolYearId", schoolYearId);
      const res = await setActiveSchoolYear(fd);
      await settleActionResult(res, "Active school year updated");
    });

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={disabled}
      loading={isPending}
      loadingText="Setting active…"
      onClick={() => {
        const handle = onSetActive ?? runStandalone;
        void Promise.resolve(handle()).catch(() => {
          /* toast already shown */
        });
      }}
    >
      Set active
    </Button>
  );
}

/** Client list so “Set active” can swap the Active badge across years instantly. */
export function SchoolYearsList({
  years,
  readOnly = false,
}: {
  years: SchoolYearListItem[];
  readOnly?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [optimisticYears, dispatchOptimistic] = useOptimistic(
    years,
    (state: SchoolYearListItem[], op: ListOptimisticOp<SchoolYearListItem>) =>
      listOptimisticReducer(state, op)
  );

  const setActive = (schoolYearId: string) =>
    runOptimistic(startTransition, async () => {
      dispatchOptimistic({
        type: "setExclusiveFlag",
        id: schoolYearId,
        flag: "isActive",
      });
      const fd = new FormData();
      fd.set("schoolYearId", schoolYearId);
      const res = await setActiveSchoolYear(fd);
      await settleActionResult(res, "Active school year updated");
    });

  const saveYear = (schoolYearId: string, draft: YearDraft) =>
    runOptimistic(startTransition, async () => {
      dispatchOptimistic({ type: "patch", id: schoolYearId, patch: draft });
      const fd = new FormData();
      fd.set("schoolYearId", schoolYearId);
      fd.set("label", draft.label);
      fd.set("startDate", draft.startDate);
      fd.set("endDate", draft.endDate);
      const res = await updateSchoolYear(fd);
      await settleActionResult(res, "School year updated");
    });

  const removeYear = (schoolYearId: string) =>
    runOptimistic(startTransition, async () => {
      dispatchOptimistic({ type: "remove", id: schoolYearId });
      const fd = new FormData();
      fd.set("schoolYearId", schoolYearId);
      const res = await deleteSchoolYear(fd);
      await settleActionResult(res, "School year removed");
    });

  return (
    <ul className="space-y-3">
      {optimisticYears.map((y) => {
        const recordCount = y.enrollmentCount + y.termGradeCount;
        // Removal exists for the duplicate-year mistake only. Anything with
        // history behind it, or the year learners are currently enrolling
        // against, stays.
        const removable = !y.isActive && recordCount === 0;

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
                {y.startDate} → {y.endDate}
                {recordCount > 0
                  ? ` · ${y.enrollmentCount} enrolled`
                  : " · no records yet"}
              </p>
            </div>

            {readOnly ? null : (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {!y.isActive ? (
                  <SetActiveYearButton
                    schoolYearId={y.id}
                    pending={pending}
                    onSetActive={() => setActive(y.id)}
                  />
                ) : null}

                <EditSchoolYearDialog
                  year={y}
                  onSave={(draft) => saveYear(y.id, draft)}
                />

                {removable ? (
                  <ConfirmAction
                    title={`Remove ${y.label}?`}
                    description="Nothing is recorded against this year yet, so removing it loses no data. This cannot be undone."
                    confirmLabel="Remove"
                    variant="destructive"
                    disabled={pending}
                    trigger={
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={pending}
                        aria-label={`Remove ${y.label}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    }
                    onConfirm={() => removeYear(y.id)}
                  />
                ) : null}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
