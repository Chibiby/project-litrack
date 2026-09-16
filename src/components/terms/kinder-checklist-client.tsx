"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  KinderChecklistToolbar,
  type KinderChecklistActionResult,
  type KinderChecklistExportResult,
  type KinderChecklistLearnerOption,
} from "@/components/terms/kinder-checklist-toolbar";
import { KinderChecklistPanel } from "@/components/terms/kinder-checklist-panel";
import { PrintableKinderChecklist } from "@/components/terms/printable-kinder-checklist";
import { kinderChecklistHref } from "@/components/terms/kinder-route";
import type {
  KinderChecklistCellState,
  KinderChecklistRowLock,
  KinderChecklistTermKey,
} from "@/components/terms/kinder-checklist-row";
import type {
  KinderCompetencyKey,
  KinderCompetencyRatingCode,
} from "@/lib/terms/kinder-competencies";
import {
  exportKinderChecklist,
  saveKinderCompetencies,
} from "@/lib/actions/kinder-competencies";

type DirtyField = "t1" | "t2" | "t3" | "remark";

type SaveEntry = {
  competencyKey: string;
  t1Rating?: KinderCompetencyRatingCode | null;
  t2Rating?: KinderCompetencyRatingCode | null;
  t3Rating?: KinderCompetencyRatingCode | null;
  remark?: string | null;
};

const EMPTY_CELL: KinderChecklistCellState = {
  t1Rating: null,
  t2Rating: null,
  t3Rating: null,
  remark: null,
};

export interface KinderChecklistClientProps {
  schoolId: string;
  advisorySectionId: string;
  /** `null` before a learner is picked — spec Open Question 1: no default learner. */
  learnerId: string | null;
  learnerName: string | null;
  learners: readonly KinderChecklistLearnerOption[];
  /** The merged 62-entry state from `mergeKinderChecklist`, serialized as entries for the client boundary. */
  initialEntries: readonly (readonly [KinderCompetencyKey, KinderChecklistCellState])[];
  locked: KinderChecklistRowLock;
  schoolName: string;
  advisoryLabel: string;
  schoolYearLabel: string;
}

/**
 * Owns the checklist's editable state: the learner picker, the four domain
 * panels, save (diffed at the touched-row grain per
 * docs/superpowers/specs/2026-09-16-kinder-end-of-term-checklist.md section 6)
 * and the export/print controls. Rendered once per (advisory, learner) via the
 * page's `key`, so switching either remounts fresh state instead of trying to
 * reconcile it.
 */
export function KinderChecklistClient({
  schoolId,
  advisorySectionId,
  learnerId,
  learnerName,
  learners,
  initialEntries,
  locked,
  schoolName,
  advisoryLabel,
  schoolYearLabel,
}: KinderChecklistClientProps) {
  const router = useRouter();
  const [states, setStates] = useState<Map<KinderCompetencyKey, KinderChecklistCellState>>(
    () => new Map(initialEntries)
  );
  const [dirty, setDirty] = useState<Map<KinderCompetencyKey, Set<DirtyField>>>(new Map());
  const [saving, startSaving] = useTransition();

  function markDirty(key: KinderCompetencyKey, field: DirtyField) {
    setDirty((prev) => {
      const next = new Map(prev);
      const fields = new Set(next.get(key));
      fields.add(field);
      next.set(key, fields);
      return next;
    });
  }

  function handleRatingChange(
    key: KinderCompetencyKey,
    term: KinderChecklistTermKey,
    value: KinderCompetencyRatingCode | null
  ) {
    setStates((prev) => {
      const next = new Map(prev);
      const current = next.get(key) ?? EMPTY_CELL;
      const field = term === "t1" ? "t1Rating" : term === "t2" ? "t2Rating" : "t3Rating";
      next.set(key, { ...current, [field]: value });
      return next;
    });
    markDirty(key, term);
  }

  function handleRemarkChange(key: KinderCompetencyKey, value: string) {
    setStates((prev) => {
      const next = new Map(prev);
      const current = next.get(key) ?? EMPTY_CELL;
      next.set(key, { ...current, remark: value });
      return next;
    });
    markDirty(key, "remark");
  }

  const dirtyCount = useMemo(
    () => [...dirty.values()].filter((fields) => fields.size > 0).length,
    [dirty]
  );

  function handleLearnerChange(nextLearnerId: string) {
    router.push(
      kinderChecklistHref({ schoolId, advisory: advisorySectionId, learner: nextLearnerId }),
      { scroll: false }
    );
  }

  function handleSave() {
    if (!learnerId) return;
    const entries: SaveEntry[] = [];
    for (const [key, fields] of dirty) {
      if (fields.size === 0) continue;
      const state = states.get(key);
      if (!state) continue;
      const entry: SaveEntry = { competencyKey: key };
      if (fields.has("t1")) entry.t1Rating = state.t1Rating;
      if (fields.has("t2")) entry.t2Rating = state.t2Rating;
      if (fields.has("t3")) entry.t3Rating = state.t3Rating;
      if (fields.has("remark")) entry.remark = state.remark?.trim() ? state.remark : null;
      entries.push(entry);
    }
    if (entries.length === 0) {
      toast.error("Nothing to save yet.");
      return;
    }

    startSaving(async () => {
      const res = await saveKinderCompetencies({
        advisorySectionId,
        learnerId,
        entries,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.data.saved === 1 ? "1 competency saved" : `${res.data.saved} competencies saved`
      );
      setDirty(new Map());
      router.refresh();
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="print:hidden">
        <KinderChecklistToolbar
          learners={learners}
          learnerId={learnerId}
          onLearnerChange={handleLearnerChange}
          advisories={[]}
          advisoryId={null}
          onAdvisoryChange={() => {}}
          onExport={() =>
            exportKinderChecklist({
              learnerId: learnerId ?? "",
              advisorySectionId,
            }) as Promise<KinderChecklistActionResult<KinderChecklistExportResult>>
          }
        />
      </div>

      {!learnerId ? (
        <div className="print:hidden rounded-2xl border border-dashed border-border/80 bg-muted/30 p-8 text-center text-sm text-muted-foreground">
          Select a learner above to open their checklist.
        </div>
      ) : (
        <>
          <div className="print:hidden">
            <KinderChecklistPanel
              states={states}
              locked={locked}
              onRatingChange={handleRatingChange}
              onRemarkChange={handleRemarkChange}
            />
          </div>

          <div className="flex justify-end print:hidden">
            <Button
              type="button"
              onClick={handleSave}
              loading={saving}
              loadingText="Saving…"
              disabled={dirtyCount === 0}
            >
              Save checklist
            </Button>
          </div>

          <div className="hidden print:block">
            <PrintableKinderChecklist
              schoolName={schoolName}
              learnerName={learnerName ?? ""}
              advisoryLabel={advisoryLabel}
              schoolYearLabel={schoolYearLabel}
              generatedAt={new Date()}
              states={states}
            />
          </div>
        </>
      )}
    </div>
  );
}
