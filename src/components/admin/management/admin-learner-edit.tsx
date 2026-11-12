"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormSectionsSkeleton } from "@/components/forms/form-skeleton";
import type {
  LearnerFormDefaults,
  LearnerFormPlacement,
} from "@/components/forms/learner-form";

const LearnerForm = dynamic(
  () => import("@/components/forms/learner-form").then((m) => m.LearnerForm),
  { ssr: false, loading: () => <FormSectionsSkeleton showBar={false} /> }
);

/**
 * "Edit learner" on the Super Admin learner profile page.
 *
 * The same learner form a teacher edits through, opened in a dialog, saving
 * through `updateLearnerAsAdmin`. A completed save closes the dialog; the
 * action's revalidate refreshes the profile behind it.
 */
export function AdminLearnerEditButton({
  learnerName,
  gradeLevelId,
  gradeType,
  placement,
  defaultValues,
}: {
  learnerName: string;
  gradeLevelId: string;
  gradeType: string;
  placement: LearnerFormPlacement;
  defaultValues: LearnerFormDefaults;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Pencil aria-hidden className="size-4" /> Edit learner
      </Button>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:rounded-xl">
        <header className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4 pr-14 sm:px-6">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md icon-glass text-primary">
            <Pencil className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <DialogTitle>Edit learner</DialogTitle>
            <DialogDescription className="mt-0.5">
              Update {learnerName}&apos;s Section A + B profile. Grade and section
              change through the School Head&apos;s transfer flow.
            </DialogDescription>
          </div>
        </header>
        {open ? (
          <LearnerForm
            gradeLevelId={gradeLevelId}
            gradeType={gradeType}
            placement={placement}
            mode="edit"
            submitLabel="Save changes"
            defaultValues={defaultValues}
            adminSave
            onSaved={() => setOpen(false)}
            onCancel={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
