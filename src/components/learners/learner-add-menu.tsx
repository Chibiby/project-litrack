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
import { EnrollLearnerDialog } from "@/components/learners/enroll-learner-dialog";
import { PromoteLearnersDialog } from "@/components/learners/promote-learners-dialog";
import type { AdvisoryPlacement } from "@/lib/teachers/advisory";

/**
 * The comp's split primary control: the button adds one learner, the chevron
 * opens the bulk route beside it. Both halves are real — the import wizard
 * already lives at /teacher/grade/[id]/import.
 */
export function LearnerAddMenu({
  placements,
  canPromote = false,
}: {
  /** Every section this teacher advises. The dialog itself decides whether that
   * is one (unchanged, static placement) or several (a required picker). */
  placements: AdvisoryPlacement[];
  /** Last month of the active school year: show Promote learners beside it. */
  canPromote?: boolean;
}) {
  // Import cannot express "which advisory" the way the dialog's picker can, so
  // it keeps targeting the first — unchanged from before multi-advisory.
  const first = placements[0];
  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
      {canPromote ? <PromoteLearnersDialog placements={placements} /> : null}
      <div className="flex w-full sm:w-auto">
        <EnrollLearnerDialog
          placements={placements}
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
              <Link href={`/teacher/grade/${first.gradeLevelId}/import`}>
                <Upload className="h-4 w-4" aria-hidden />
                Import from file
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/**
 * Stands in for the add control when the teacher advises no section, or when
 * there is no active school year to enroll into.
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
        Enroll learner
      </Button>
      <p className="max-w-xs text-xs text-muted-foreground sm:text-right">
        {reason}
      </p>
    </div>
  );
}
