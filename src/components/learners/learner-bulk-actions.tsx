"use client";

import { useState } from "react";
import {
  ArrowLeftRight,
  ChevronDown,
  Download,
  Sparkles,
  Trash2,
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
import { ConfirmAction } from "@/components/confirm-action";

/**
 * The roster's bulk action menu, occupying the slot the comp gives to Filter
 * and Export. Delete is wired; the rest are declared but inert on purpose, so
 * the menu shows where those capabilities will land without pretending they
 * work yet. Each inert row is disabled and labelled "Soon" — never a silent
 * no-op the teacher would read as a failure.
 */

/** Actions the menu will grow into. Keep the labels, wire them one at a time. */
const PLANNED = [
  { key: "transfer", label: "Transfer student", icon: ArrowLeftRight },
  { key: "aral", label: "Enroll in ARAL", icon: Sparkles },
  { key: "export", label: "Export selected", icon: Download },
] as const;

export function LearnerBulkActions({
  selectedCount,
  onDelete,
  pending = false,
}: {
  selectedCount: number;
  onDelete: () => Promise<void> | void;
  pending?: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const hasSelection = selectedCount > 0;

  return (
    <>
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
            // Radix closes the menu before the dialog mounts; opening on the
            // next frame keeps focus from returning to an unmounted trigger.
            onSelect={(e) => {
              e.preventDefault();
              requestAnimationFrame(() => setConfirmOpen(true));
            }}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Delete
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

      <ConfirmAction
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Delete ${selectedCount} learner${selectedCount === 1 ? "" : "s"}?`}
        // Truthful about reversibility: the delete is recoverable in the
        // database, but there is no self-service restore for a teacher yet.
        description="They will be removed from your roster, your counts and every report. Their attendance and reading-level records are kept, but you cannot undo this yourself — tell your School Head if you remove someone by mistake."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={onDelete}
      />
    </>
  );
}
