"use client";

import { useId, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { purgeArchivedLearner } from "@/lib/actions/learner-purge";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";

export type PurgeTarget = { id: string; fullName: string };

const normalizeName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

type Props = {
  target: PurgeTarget;
  onClose: () => void;
  /** Runs after the server confirmed the deletion. */
  onPurged: () => void;
};

/**
 * Permanent removal of an archived learner, gated on typing their full name.
 * Mounted only while a learner is targeted, so the typed text starts empty
 * every time and survives a failed attempt.
 */
export function LearnerPurgeConfirm({ target, onClose, onPurged }: Props) {
  const inputId = useId();
  const errorId = useId();
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const matches = normalizeName(typed) === normalizeName(target.fullName);

  const submit = async () => {
    if (!matches || pending) return;
    setPending(true);
    setFieldError(null);
    try {
      const fd = new FormData();
      fd.set("id", target.id);
      fd.set("confirmName", typed);
      const res = await callAction(() => purgeArchivedLearner(fd));
      if (!res.ok) {
        setFieldError(res.fieldErrors?.confirmName ?? null);
        toastFailure(res);
        return;
      }
      toast.success(`${target.fullName} was permanently removed`);
      onPurged();
      onClose();
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {target.fullName} permanently?</AlertDialogTitle>
          <AlertDialogDescription>
            {target.fullName} and all of their records, including attendance,
            reading levels, MOSY, grades, and ARAL profile, will be permanently
            deleted. This cannot be undone and the learner cannot be restored.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="grid gap-2">
          <Label htmlFor={inputId}>
            Type <span className="font-semibold">{target.fullName}</span> to
            confirm
          </Label>
          <Input
            id={inputId}
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setFieldError(null);
            }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={pending}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? errorId : undefined}
          />
          {fieldError ? (
            <p id={errorId} role="alert" className="text-sm text-destructive">
              {fieldError}
            </p>
          ) : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={!matches || pending}
            aria-busy={pending || undefined}
            onClick={submit}
          >
            {pending ? (
              <>
                <Loader2 className="animate-spin" aria-hidden />
                Removing…
              </>
            ) : (
              "Remove permanently"
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
