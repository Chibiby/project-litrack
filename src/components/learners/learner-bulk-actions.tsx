"use client";

import {
  ArrowLeftRight,
  Archive,
  ChevronDown,
  Download,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * The roster's bulk action menu, occupying the slot the comp gives to Filter
 * and Export. Archive and Enroll in ARAL are wired; the rest are declared but
 * inert on purpose, so the menu shows where those capabilities will land
 * without pretending they work yet. Each inert row is disabled and labelled
 * "Soon" — never a silent no-op the teacher would read as a failure.
 */

/** Actions the menu will grow into. Keep the labels, wire them one at a time. */
const PLANNED = [
  { key: "transfer", label: "Transfer student", icon: ArrowLeftRight },
  { key: "export", label: "Export selected", icon: Download },
] as const;

export function LearnerBulkActions({
  selectedCount,
  onArchive,
  onEnrollAral,
  pending = false,
}: {
  selectedCount: number;
  onArchive: () => Promise<void> | void;
  /**
   * Opens the ARAL tutor picker for the selection. The menu does not enroll by
   * itself: a learner needs a tutor before joining the program, and naming one
   * is a choice, not a confirmation.
   */
  onEnrollAral: () => void;
  pending?: boolean;
}) {
  const hasSelection = selectedCount > 0;

  return (
    <div className="flex flex-wrap gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            className="w-full sm:w-auto"
          >
            Bulk actions
            {hasSelection ? (
              <span className="ml-1 tabular-nums text-muted-foreground">
                ({selectedCount})
              </span>
            ) : null}
            <ChevronDown className="h-4 w-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {hasSelection
              ? `${selectedCount} learner${selectedCount === 1 ? "" : "s"} selected`
              : "Select learners to act on"}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          <DropdownMenuItem
            disabled={!hasSelection || pending}
            // Same reason as Archive: Radix unmounts the trigger before the
            // dialog mounts, so opening on the next frame keeps focus from
            // returning to something that is no longer there.
            onSelect={(e) => {
              e.preventDefault();
              requestAnimationFrame(onEnrollAral);
            }}
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            Enroll in ARAL
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {PLANNED.map(({ key, label, icon: Icon }) => (
            <DropdownMenuItem key={key} disabled>
              <Icon className="h-4 w-4" aria-hidden />
              {label}
              <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Soon
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {hasSelection ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={onArchive}
        >
          <Archive className="h-4 w-4" aria-hidden />
          Archive
        </Button>
      ) : null}

    </div>
  );
}
