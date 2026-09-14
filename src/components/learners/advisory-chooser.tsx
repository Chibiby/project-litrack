"use client";

import { GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import type { AdvisoryPlacement } from "@/lib/teachers/advisory";

/**
 * Same sentence as `NO_ADVISORY_MESSAGE` (`src/lib/teachers/advisory.ts`),
 * duplicated rather than imported: that module is `server-only`, and this is
 * a client component. In the one place this dialog is mounted today
 * (`src/app/teacher/(app)/learners/page.tsx`) a teacher with zero advisories
 * never reaches it — the page swaps in `LearnerAddMenuDisabled` first, using
 * the real constant — so this text is a defensive fallback, not the source of
 * truth. Keep it byte-identical to `NO_ADVISORY_MESSAGE` if that ever changes.
 */
const NO_ADVISORY_FALLBACK_MESSAGE =
  "You have no advisory section yet. Ask your School Head to assign you one before adding learners.";

/**
 * Add learner, step one — which of the teacher's advisory sections the new
 * learner joins. Always shown, even for a teacher with exactly one advisory
 * (owner decision, overruling docs/reading-policy-spec.md section 8.4 / 9.3):
 * with one section it opens pre-selected so the teacher confirms rather than
 * picks; with several, nothing is pre-selected; with none, an explanatory
 * empty state stands in and the learner form never mounts.
 *
 * Presentational only — `add-learner-dialog.tsx` owns the step state and the
 * single `Dialog` both steps share, so focus stays trapped in one modal
 * across the hand-off to `LearnerForm` rather than nesting a second dialog.
 */
export function AdvisoryChooser({
  placements,
  selectedSectionId,
  onSelectedSectionIdChange,
  onContinue,
  onCancel,
}: {
  placements: AdvisoryPlacement[];
  selectedSectionId: string;
  onSelectedSectionIdChange: (sectionId: string) => void;
  onContinue: () => void;
  onCancel: () => void;
}) {
  if (placements.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-5 py-10 text-center sm:px-6">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <GraduationCap className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">
            No advisory section yet
          </p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {NO_ADVISORY_FALLBACK_MESSAGE}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onCancel} className="mt-2">
          Close
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-5 sm:px-6">
        <p className="text-sm text-muted-foreground">
          {placements.length === 1
            ? "Confirm which section this learner joins."
            : "Choose which of your advisory sections this learner joins."}
        </p>
        <RadioGroup
          value={selectedSectionId}
          onValueChange={onSelectedSectionIdChange}
          aria-label="Grade & section"
        >
          {placements.map((p) => (
            <Label
              key={p.sectionId}
              htmlFor={`advisory-chooser-${p.sectionId}`}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition-colors",
                selectedSectionId === p.sectionId
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/50"
              )}
            >
              <RadioGroupItem
                id={`advisory-chooser-${p.sectionId}`}
                value={p.sectionId}
              />
              <span>
                {p.gradeLabel}
                <span className="px-1.5 font-normal text-muted-foreground">·</span>
                {p.sectionName}
              </span>
            </Label>
          ))}
        </RadioGroup>
      </div>
      <footer className="flex flex-col-reverse gap-2 border-t border-border bg-muted/30 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          className="justify-center"
        >
          Cancel
        </Button>
        <Button
          type="button"
          onClick={onContinue}
          disabled={!selectedSectionId}
          className="justify-center"
        >
          Continue
        </Button>
      </footer>
    </div>
  );
}
