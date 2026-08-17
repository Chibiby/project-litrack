"use client";

import Link from "next/link";
import { ChevronDown, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AddLearnerDialog } from "@/components/learners/add-learner-dialog";
import type {
  LearnerFormGradeOption,
  LearnerFormSectionOption,
} from "@/components/forms/learner-form";

/**
 * The comp's split primary control: the button adds one learner, the chevron
 * opens the bulk route beside it. Both halves are real — the import wizard
 * already lives at /teacher/grade/[id]/import.
 */
export function LearnerAddMenu({
  gradeLevelId,
  grades,
  sections,
}: {
  gradeLevelId: string;
  grades: LearnerFormGradeOption[];
  sections: LearnerFormSectionOption[];
}) {
  return (
    <div className="flex w-full sm:w-auto">
      <AddLearnerDialog
        gradeLevelId={gradeLevelId}
        grades={grades}
        sections={sections}
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
