"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { LEARNER_REMOVAL_REASON_LABELS } from "@/lib/constants/enum-labels";
import { failureForRejection, toastFailure } from "@/lib/ui/toast-failure";

export type LearnerRemovalReasonKey = keyof typeof LEARNER_REMOVAL_REASON_LABELS;
export type LearnerRemoval = { reason: LearnerRemovalReasonKey; note: string };

/** Mirrors `removalNoteSchema` on the server. */
export const REMOVAL_NOTE_MAX = 300;

const REASONS = Object.entries(LEARNER_REMOVAL_REASON_LABELS) as [
  LearnerRemovalReasonKey,
  string,
][];

/** Copy the removal into a FormData the archive actions read. */
export function appendRemoval(fd: FormData, removal: LearnerRemoval): void {
  fd.set("removalReason", removal.reason);
  if (removal.note.trim()) fd.set("removalNote", removal.note.trim());
}

/**
 * The Remove confirmation, with a required reason. Same open/close and
 * failure behaviour as `ConfirmAction`: a rejected `onConfirm` keeps it open
 * for a retry (already toasted), anything else closes it.
 */
export function RemoveLearnerDialog({
  title,
  description,
  confirmLabel = "Remove",
  cancelLabel = "Cancel",
  disabled,
  open,
  onOpenChange,
  trigger,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  disabled?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: React.ReactNode;
  onConfirm: (removal: LearnerRemoval) => void | Promise<void>;
}) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [reason, setReason] = React.useState<LearnerRemovalReasonKey | "">("");
  const [note, setNote] = React.useState("");
  const [showError, setShowError] = React.useState(false);
  const id = React.useId();
  const isControlled = open !== undefined;
  const resolvedOpen = isControlled ? open : internalOpen;

  const setOpen = (next: boolean) => {
    if (!isControlled) setInternalOpen(next);
    if (next) {
      setReason("");
      setNote("");
      setShowError(false);
    }
    onOpenChange?.(next);
  };

  const noteRequired = reason === "OTHER";
  const missing = !reason ? "Choose a reason." : noteRequired && !note.trim() ? "Say why in the box." : null;

  return (
    <AlertDialog open={resolvedOpen} onOpenChange={setOpen}>
      {trigger ? (
        <AlertDialogTrigger asChild disabled={disabled}>
          {trigger}
        </AlertDialogTrigger>
      ) : null}
      <AlertDialogContent className="max-h-[90dvh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <fieldset className="space-y-3" disabled={pending}>
          <legend className="mb-2 text-sm font-medium">Reason for removing</legend>
          <RadioGroup
            value={reason}
            onValueChange={(v) => setReason(v as LearnerRemovalReasonKey)}
            aria-label="Reason for removing"
            className="gap-2"
          >
            {REASONS.map(([value, label]) => (
              <Label
                key={value}
                htmlFor={`${id}-${value}`}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border/80 px-3 py-2.5 text-sm font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
              >
                <RadioGroupItem id={`${id}-${value}`} value={value} className="mt-0.5" />
                <span>{label}</span>
              </Label>
            ))}
          </RadioGroup>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-note`}>
              {noteRequired ? "Say why" : "Note"}{" "}
              {noteRequired ? null : (
                <span className="font-normal text-muted-foreground">(optional)</span>
              )}
            </Label>
            <Textarea
              id={`${id}-note`}
              value={note}
              maxLength={REMOVAL_NOTE_MAX}
              rows={2}
              onChange={(e) => setNote(e.target.value)}
              aria-required={noteRequired || undefined}
            />
          </div>
          {showError && missing ? (
            <p role="alert" className="text-sm text-destructive">
              {missing}
            </p>
          ) : null}
        </fieldset>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            disabled={pending}
            aria-busy={pending || undefined}
            onClick={async (e) => {
              e.preventDefault();
              if (missing || !reason) {
                setShowError(true);
                return;
              }
              setPending(true);
              try {
                await onConfirm({ reason, note });
                setOpen(false);
              } catch (err) {
                const failure = failureForRejection(err);
                if (failure) toastFailure(failure);
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Working…
              </>
            ) : (
              confirmLabel
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
