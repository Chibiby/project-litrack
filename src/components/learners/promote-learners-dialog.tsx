"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { GraduationCap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EnrollAdvisoryPicker } from "@/components/learners/enroll-advisory-picker";
import { listPromotionRoster, savePromotionOutcomes } from "@/lib/actions/promotion";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";
import { cn } from "@/lib/utils";
import type { AdvisoryPlacement } from "@/lib/teachers/advisory";
import type { PromotionRosterEntry } from "@/lib/learners/masterlist";

type Outcome = "PROMOTED" | "RETAINED";

/**
 * Promote learners — shown only in the last month of the active school year.
 * The adviser marks each learner Promoted (default) or Retained; next year they
 * appear on the matching grade's enroll masterlist.
 */
export function PromoteLearnersDialog({
  placements,
  triggerClassName,
}: {
  placements: AdvisoryPlacement[];
  triggerClassName?: string;
}) {
  const idBase = useId();
  const [open, setOpen] = useState(false);
  const [sectionId, setSectionId] = useState(
    placements.length === 1 ? placements[0].sectionId : ""
  );
  const placement = placements.find((p) => p.sectionId === sectionId) ?? null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className={cn("w-full sm:w-auto", triggerClassName)}>
          <GraduationCap className="h-4 w-4" aria-hidden />
          Promote learners
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
        <header className="space-y-3 border-b border-border px-5 py-4 pr-14 sm:px-6">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <GraduationCap className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <DialogTitle>Promote learners</DialogTitle>
              <DialogDescription className="mt-0.5">
                Mark each learner Promoted or Retained. Next school year they wait on the
                enroll masterlist of the grade they move to.
              </DialogDescription>
            </div>
          </div>
          <EnrollAdvisoryPicker
            id={`${idBase}-advisory`}
            placements={placements}
            value={sectionId}
            onChange={setSectionId}
          />
        </header>
        {open && placement ? (
          <PromotionPanel key={placement.sectionId} placement={placement} onDone={() => setOpen(false)} />
        ) : open ? (
          <p className="px-5 py-6 text-sm text-muted-foreground sm:px-6">
            Choose which advisory section to promote.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PromotionPanel({
  placement,
  onDone,
}: {
  placement: AdvisoryPlacement;
  onDone: () => void;
}) {
  const [rows, setRows] = useState<PromotionRosterEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Record<string, Outcome>>({});
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let live = true;
    void callAction(() => listPromotionRoster(placement.sectionId)).then((res) => {
      if (!live) return;
      if (!res.ok) {
        setLoadError(res.error);
        return;
      }
      setRows(res.data);
      setChoice(Object.fromEntries(res.data.map((r) => [r.learnerId, r.outcome ?? "PROMOTED"])));
    });
    return () => {
      live = false;
    };
  }, [placement.sectionId]);

  const counts = Object.values(choice).reduce(
    (acc, o) => ({ ...acc, [o]: acc[o] + 1 }),
    { PROMOTED: 0, RETAINED: 0 } as Record<Outcome, number>
  );

  function save() {
    const outcomes = Object.entries(choice).map(([learnerId, outcome]) => ({ learnerId, outcome }));
    startTransition(async () => {
      const res = await callAction(() =>
        savePromotionOutcomes({ sectionId: placement.sectionId, outcomes })
      );
      if (!res.ok) {
        toastFailure(res);
        return;
      }
      toast.success(`Saved: ${res.promoted} promoted, ${res.retained} retained`);
      onDone();
    });
  }

  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 sm:px-6">
        {rows === null && !loadError ? (
          <div className="space-y-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : rows && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No learners are enrolled in this advisory.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {counts.PROMOTED} promoted · {counts.RETAINED} retained
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() =>
                  setChoice(Object.fromEntries((rows ?? []).map((r) => [r.learnerId, "PROMOTED"])))
                }
              >
                Mark all promoted
              </Button>
            </div>
            <ul className="divide-y divide-border rounded-lg border border-border" aria-label="Learners">
              {(rows ?? []).map((r) => (
                <li key={r.learnerId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 basis-40 break-words font-medium">{r.name}</span>
                  <div role="radiogroup" aria-label={`Outcome for ${r.name}`} className="flex gap-1 rounded-lg bg-muted p-1">
                    {(["PROMOTED", "RETAINED"] as const).map((o) => (
                      <Button
                        key={o}
                        type="button"
                        role="radio"
                        aria-checked={choice[r.learnerId] === o}
                        size="sm"
                        variant={choice[r.learnerId] === o ? (o === "PROMOTED" ? "default" : "secondary") : "ghost"}
                        className="h-8 px-3"
                        onClick={() => setChoice((prev) => ({ ...prev, [r.learnerId]: o }))}
                      >
                        {o === "PROMOTED" ? "Promoted" : "Retained"}
                      </Button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <footer className="flex flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:justify-end sm:px-6">
        <Button type="button" variant="outline" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={save}
          disabled={!rows || rows.length === 0}
          loading={pending}
          loadingText="Saving…"
        >
          Save promotion list
        </Button>
      </footer>
    </>
  );
}
