"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type {
  LearnerFormGradeOption,
  LearnerFormSectionOption,
} from "@/components/forms/learner-form";
import { Plus } from "lucide-react";

const LearnerForm = dynamic(
  () =>
    import("@/components/forms/learner-form").then((m) => m.LearnerForm),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-4" aria-hidden>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-32" />
      </div>
    ),
  }
);

type Props = {
  gradeLevelId: string;
  grades: LearnerFormGradeOption[];
  sections: LearnerFormSectionOption[];
  /** Lets the roster header square off the right edge for its split control. */
  triggerClassName?: string;
};

/**
 * Defers the heavy LearnerForm chunk until the teacher opens "Add learner".
 */
export function AddLearnerDialog({
  gradeLevelId,
  grades,
  sections,
  triggerClassName,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          size="sm"
          className={cn("w-full sm:w-auto", triggerClassName)}
        >
          <Plus className="h-4 w-4" />
          Add new learner
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle>Add new learner</SheetTitle>
          <SheetDescription>
            Create a Section A + B profile for this grade.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6">
          {open ? (
            <LearnerForm
              gradeLevelId={gradeLevelId}
              grades={grades}
              sections={sections}
              onCreated={() => setOpen(false)}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
