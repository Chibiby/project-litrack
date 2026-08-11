"use client";

import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSchoolYear, setActiveSchoolYear } from "@/lib/actions/school-year";
import {
  listOptimisticReducer,
  runOptimistic,
  settleActionResult,
  type ListOptimisticOp,
} from "@/lib/ui/optimistic";

export function CreateSchoolYearForm() {
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      action={(fd) =>
        startTransition(async () => {
          const res = await createSchoolYear(fd);
          if (!res.ok) toast.error(res.error);
          else toast.success("School year created");
        })
      }
    >
      <div className="space-y-2">
        <Label htmlFor="label">Label</Label>
        <Input id="label" name="label" placeholder="2025-2026" required disabled={pending} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="startDate">Start date</Label>
          <Input id="startDate" name="startDate" type="date" required disabled={pending} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endDate">End date</Label>
          <Input id="endDate" name="endDate" type="date" required disabled={pending} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="setActive" value="true" className="rounded border" />
        Set as active school year
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Create school year"}
      </Button>
    </form>
  );
}

export type SchoolYearListItem = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
};

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
      disabled={disabled || isPending}
      onClick={() => {
        const handle = onSetActive ?? runStandalone;
        void Promise.resolve(handle()).catch(() => {
          /* toast already shown */
        });
      }}
    >
      {isPending ? "…" : "Set active"}
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

  return (
    <ul className="space-y-3">
      {optimisticYears.map((y) => (
        <li
          key={y.id}
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 px-4 py-3"
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{y.label}</span>
              {y.isActive ? <Badge>Active</Badge> : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {y.startDate} → {y.endDate}
            </p>
          </div>
          {!readOnly && !y.isActive ? (
            <SetActiveYearButton
              schoolYearId={y.id}
              pending={pending}
              onSetActive={() => setActive(y.id)}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
