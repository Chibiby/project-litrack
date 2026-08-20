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
import type { LearnerFormPlacement } from "@/components/forms/learner-form";
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
  gradeLevelId: string;
  gradeType: string;
  /** The teacher's advisory, shown in the form instead of a grade/section picker. */
  placement: LearnerFormPlacement;
  /** Lets the roster header square off the right edge for its split control. */
  triggerClassName?: string;
};

/**
 * Add learner — a dialog whose only job is adding, so nothing here branches on
 * an edit mode. The form is divided into four collapsible sections with a
 * completion bar; the dialog contributes the header and lets the form own the
 * scrolling body and the footer, which is why DialogContent is a bare flex
 * column with no padding of its own.
 *
 * Defers the heavy LearnerForm chunk until the teacher opens "Add learner".
 */
export function AddLearnerDialog({
  gradeLevelId,
  gradeType,
  placement,
  triggerClassName,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
              Create a Section A + B profile for {placement.gradeLabel}
              {placement.sectionName ? ` · ${placement.sectionName}` : ""}.
            </DialogDescription>
          </div>
        </header>

        {open ? (
          <LearnerForm
            gradeLevelId={gradeLevelId}
            gradeType={gradeType}
            placement={placement}
            onCreated={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
