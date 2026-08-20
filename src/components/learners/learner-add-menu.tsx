"use client";

import Link from "next/link";
import { ChevronDown, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AddLearnerDialog } from "@/components/learners/add-learner-dialog";
import type { LearnerFormPlacement } from "@/components/forms/learner-form";

/**
 * The comp's split primary control: the button adds one learner, the chevron
 * opens the bulk route beside it. Both halves are real — the import wizard
 * already lives at /teacher/grade/[id]/import.
 */
export function LearnerAddMenu({
  gradeLevelId,
  gradeType,
  placement,
}: {
  gradeLevelId: string;
  gradeType: string;
  placement: LearnerFormPlacement;
}) {
  return (
    <div className="flex w-full sm:w-auto">
      <AddLearnerDialog
        gradeLevelId={gradeLevelId}
        gradeType={gradeType}
        placement={placement}
        triggerClassName="rounded-r-none"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            aria-label="More ways to add learners"
            className="rounded-l-none border-l border-primary-foreground/25 px-2"
          >
            <ChevronDown className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem asChild>
            <Link href={`/teacher/grade/${gradeLevelId}/import`}>
              <Upload className="h-4 w-4" aria-hidden />
              Import from file
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * Stands in for the add control when the teacher advises no section.
 *
 * A learner has to land somewhere, and the only somewhere a teacher can create
 * one is their own advisory — so the button says why it cannot be pressed rather
 * than opening a dialog that could only fail on submit. The reason is the same
 * sentence the server returns, so the two can never drift.
 */
export function LearnerAddMenuDisabled({ reason }: { reason: string }) {
  return (
    <div className="flex w-full flex-col items-start gap-1 sm:w-auto sm:items-end">
      <Button type="button" size="sm" disabled className="w-full sm:w-auto">
        <Plus className="h-4 w-4" aria-hidden />
        Add new learner
      </Button>
      <p className="max-w-xs text-xs text-muted-foreground sm:text-right">
        {reason}
      </p>
    </div>
  );
}
