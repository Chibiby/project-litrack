"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { FormSectionsSkeleton } from "@/components/forms/form-skeleton";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { AdvisoryChooser } from "@/components/learners/advisory-chooser";
import type { AdvisoryPlacement } from "@/lib/teachers/advisory";
import { Plus, UserRoundPlus } from "lucide-react";

const LearnerForm = dynamic(
  () =>
    import("@/components/forms/learner-form").then((m) => m.LearnerForm),
  {
    ssr: false,
    // Holds the sectioned form's real geometry — completion bar over four
    // section headers — so the dialog does not resize when the chunk lands.
    loading: () => <FormSectionsSkeleton />,
  }
);

type Props = {
  /** Every section this teacher advises. Step one always asks which one, even
   * when there is only one to pick (owner decision — see advisory-chooser.tsx). */
  placements: AdvisoryPlacement[];
  /** Lets the roster header square off the right edge for its split control. */
  triggerClassName?: string;
};

/** The pre-selected default for a one-advisory teacher; empty for everyone else. */
function initialSectionId(placements: AdvisoryPlacement[]): string {
  return placements.length === 1 ? placements[0].sectionId : "";
}

/**
 * Add learner — two steps in one dialog: which advisory section the learner
 * joins, then the Section A + B form for it. One `Dialog` spans both steps
 * (rather than nesting a second) so focus stays trapped in a single modal
 * across the hand-off, and the form only ever mounts once a placement is
 * confirmed — it never asks again.
 *
 * Defers the heavy LearnerForm chunk until the teacher reaches step two.
 */
export function AddLearnerDialog({
  placements,
  triggerClassName,
}: Props) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"choose" | "form">("choose");
  const [selectedSectionId, setSelectedSectionId] = useState(() =>
    initialSectionId(placements)
  );

  const selectedPlacement = placements.find(
    (p) => p.sectionId === selectedSectionId
  );

  function resetChooser() {
    setStep("choose");
    setSelectedSectionId(initialSectionId(placements));
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Reset on close (cancel or ✕) so a reopen never carries a stale pick —
    // and on open, since `initialSectionId` may have changed if the teacher's
    // advisories changed between visits.
    if (!next) resetChooser();
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          className={cn("w-full sm:w-auto", triggerClassName)}
        >
          <Plus className="h-4 w-4" />
          Add new learner
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl">
        <header className="flex items-start gap-3 border-b border-border px-5 py-4 pr-14 sm:px-6">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UserRoundPlus className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <DialogTitle>Add new learner</DialogTitle>
            <DialogDescription className="mt-0.5">
              {step === "choose"
                ? "Choose which of your advisory sections this learner joins."
                : selectedPlacement
                  ? `Create a Section A + B profile for ${selectedPlacement.gradeLabel} · ${selectedPlacement.sectionName}.`
                  : "Create a Section A + B profile."}
            </DialogDescription>
          </div>
        </header>

        {open && step === "choose" ? (
          <AdvisoryChooser
            placements={placements}
            selectedSectionId={selectedSectionId}
            onSelectedSectionIdChange={setSelectedSectionId}
            onContinue={() => setStep("form")}
            onCancel={() => handleOpenChange(false)}
          />
        ) : null}

        {open && step === "form" && selectedPlacement ? (
          <LearnerForm
            gradeLevelId={selectedPlacement.gradeLevelId}
            gradeType={selectedPlacement.gradeType}
            sectionId={selectedPlacement.sectionId}
            placement={{
              gradeLabel: selectedPlacement.gradeLabel,
              sectionName: selectedPlacement.sectionName,
            }}
            onCreated={() => handleOpenChange(false)}
            onCancel={() => handleOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
