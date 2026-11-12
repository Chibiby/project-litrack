"use client";

import { useEffect, useId, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { ListChecks, Plus, UserRoundPlus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { SearchInput } from "@/components/ui/search-input";
import { FormSectionsSkeleton } from "@/components/forms/form-skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  UnsavedChangesDialog,
  useUnsavedChangesPrompt,
} from "@/components/unsaved-changes-dialog";
import { EnrollAdvisoryPicker } from "@/components/learners/enroll-advisory-picker";
import { enrollFromMasterlist, listEnrollMasterlist } from "@/lib/actions/enroll-learner";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";
import { ENROLLMENT_OUTCOME_LABELS } from "@/lib/constants/enum-labels";
import { cn } from "@/lib/utils";
import type { AdvisoryPlacement } from "@/lib/teachers/advisory";
import type { MasterlistEntry } from "@/lib/learners/masterlist";

const LearnerForm = dynamic(
  () => import("@/components/forms/learner-form").then((m) => m.LearnerForm),
  { ssr: false, loading: () => <FormSectionsSkeleton /> }
);

type Tab = "masterlist" | "new";

function initialSectionId(placements: AdvisoryPlacement[]): string {
  return placements.length === 1 ? placements[0].sectionId : "";
}

/**
 * Enroll learner. Opens on the masterlist: last year's learners at this school
 * who were promoted into, or retained in, the chosen advisory's grade. The
 * second tab is the new-learner form for someone not on it.
 */
export function EnrollLearnerDialog({
  placements,
  triggerClassName,
}: {
  placements: AdvisoryPlacement[];
  triggerClassName?: string;
}) {
  const idBase = useId();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("masterlist");
  const [sectionId, setSectionId] = useState(() => initialSectionId(placements));
  const [dirty, setDirty] = useState(false);
  const { guard, dialogProps } = useUnsavedChangesPrompt(dirty);

  const placement = placements.find((p) => p.sectionId === sectionId) ?? null;

  function setOpenNow(next: boolean) {
    setOpen(next);
    if (!next) {
      setDirty(false);
      setTab("masterlist");
      setSectionId(initialSectionId(placements));
    }
  }

  function handleOpenChange(next: boolean) {
    if (next) setOpenNow(true);
    else guard(() => setOpenNow(false));
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" className={cn("w-full sm:w-auto", triggerClassName)}>
          <Plus className="h-4 w-4" aria-hidden />
          Enroll learner
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
        <header className="space-y-3 border-b border-border px-5 py-4 pr-14 sm:px-6">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md icon-glass text-primary">
              <UserRoundPlus className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <DialogTitle>Enroll learner</DialogTitle>
              <DialogDescription className="mt-0.5">
                Learners are enrolled into the current school year.
              </DialogDescription>
            </div>
          </div>
          <EnrollAdvisoryPicker
            id={`${idBase}-advisory`}
            placements={placements}
            value={sectionId}
            onChange={(v) => guard(() => {
              setDirty(false);
              setSectionId(v);
            })}
          />
          <div role="tablist" aria-label="How to enroll" className="flex gap-1 rounded-lg bg-muted p-1">
            {(
              [
                ["masterlist", "Promoted masterlist", ListChecks],
                ["new", "New learner", UserRoundPlus],
              ] as const
            ).map(([value, label, Icon]) => (
              <Button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                variant={tab === value ? "default" : "ghost"}
                size="sm"
                className="flex-1"
                onClick={() => guard(() => {
                  setDirty(false);
                  setTab(value);
                })}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </Button>
            ))}
          </div>
        </header>

        {open && !placement ? (
          <p className="px-5 py-6 text-sm text-muted-foreground sm:px-6">
            Choose which advisory section to enroll into.
          </p>
        ) : null}

        {open && placement && tab === "masterlist" ? (
          <MasterlistPanel
            key={placement.sectionId}
            placement={placement}
            onEnrolled={() => setOpenNow(false)}
            onCancel={() => handleOpenChange(false)}
          />
        ) : null}

        {open && placement && tab === "new" ? (
          <LearnerForm
            key={placement.sectionId}
            gradeLevelId={placement.gradeLevelId}
            gradeType={placement.gradeType}
            sectionId={placement.sectionId}
            placement={{ gradeLabel: placement.gradeLabel, sectionName: placement.sectionName }}
            onCreated={() => setOpenNow(false)}
            onCancel={() => handleOpenChange(false)}
            onDirtyChange={setDirty}
          />
        ) : null}

        <UnsavedChangesDialog {...dialogProps} />
      </DialogContent>
    </Dialog>
  );
}

function MasterlistPanel({
  placement,
  onEnrolled,
  onCancel,
}: {
  placement: AdvisoryPlacement;
  onEnrolled: () => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<MasterlistEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void callAction(() => listEnrollMasterlist({ sectionId: placement.sectionId })).then((res) => {
      if (!live) return;
      if (res.ok) setRows(res.data);
      else setLoadError(res.error);
    });
    return () => {
      live = false;
    };
  }, [placement.sectionId]);

  const term = q.trim().toLowerCase();
  const visible = (rows ?? []).filter((r) => !term || r.name.toLowerCase().includes(term));
  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(r.learnerId));

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllVisible(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of visible) {
        if (on) next.add(r.learnerId);
        else next.delete(r.learnerId);
      }
      return next;
    });
  }

  function enroll() {
    const learnerIds = [...selected];
    startTransition(async () => {
      const res = await callAction(() =>
        enrollFromMasterlist({ sectionId: placement.sectionId, learnerIds })
      );
      if (!res.ok) {
        toastFailure(res);
        return;
      }
      toast.success(
        `${res.enrolled} learner${res.enrolled === 1 ? "" : "s"} enrolled in ${placement.label}`
      );
      onEnrolled();
    });
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 sm:px-6">
        <p className="text-sm text-muted-foreground">
          Learners at your school who were promoted into, or retained in,{" "}
          <span className="font-medium text-foreground">{placement.gradeLabel}</span> and are not
          enrolled yet.
        </p>
        {rows === null && !loadError ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : rows && rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <p className="font-medium">No one is waiting to be enrolled</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Use New learner for a learner who is not on this list.
            </p>
          </div>
        ) : (
          <>
            <SearchInput
              label="Search the masterlist"
              placeholder="Learner name…"
              value={q}
              onValueChange={setQ}
              resultCount={visible.length}
            />
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={(v) => toggleAllVisible(v === true)}
                disabled={visible.length === 0}
              />
              Select all {visible.length > 0 ? `(${visible.length})` : ""}
            </label>
            <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Masterlist">
              {visible.map((r) => (
                <li key={r.learnerId}>
                  <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50">
                    <Checkbox
                      checked={selected.has(r.learnerId)}
                      onCheckedChange={(v) => toggle(r.learnerId, v === true)}
                      aria-label={`Select ${r.name}`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.fromGradeLabel}
                        {r.fromSectionName ? ` · ${r.fromSectionName}` : ""} · {r.fromYearLabel}
                      </span>
                    </span>
                    <Badge variant={r.outcome === "PROMOTED" ? "default" : "secondary"}>
                      {ENROLLMENT_OUTCOME_LABELS[r.outcome]}
                    </Badge>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <footer className="flex flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:justify-end sm:px-6">
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={enroll}
          disabled={selected.size === 0}
          loading={pending}
          loadingText="Enrolling…"
        >
          Enroll {selected.size > 0 ? selected.size : ""} learner{selected.size === 1 ? "" : "s"}
        </Button>
      </footer>
    </>
  );
}
