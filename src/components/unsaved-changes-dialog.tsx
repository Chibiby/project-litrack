"use client";

import { useCallback, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";

const DEFAULT_DESCRIPTION =
  "Your edits have not been saved. If you discard them, they are lost.";

type UnsavedChangesDialogProps = {
  open: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
  description?: string;
};

/** App-styled replacement for the browser's confirm box on in-app exits. */
export function UnsavedChangesDialog({
  open,
  onKeepEditing,
  onDiscard,
  description = DEFAULT_DESCRIPTION,
}: UnsavedChangesDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onKeepEditing();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard changes?</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep editing</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={onDiscard}
          >
            Discard changes
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Wrap every way out of a dirty form (X, Escape, overlay, Cancel) in `guard`.
 * Clean: runs at once. Dirty: parks the exit behind the discard dialog.
 */
export function useUnsavedChangesPrompt(dirty: boolean) {
  const [pending, setPending] = useState<{ run: () => void } | null>(null);

  const guard = useCallback(
    (run: () => void) => {
      if (dirty) setPending({ run });
      else run();
    },
    [dirty]
  );

  const dialogProps = {
    open: pending !== null,
    onKeepEditing: () => setPending(null),
    onDiscard: () => {
      const exit = pending;
      setPending(null);
      exit?.run();
    },
  };

  return { guard, dialogProps };
}
