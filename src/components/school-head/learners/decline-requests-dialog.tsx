"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { declineSectionTransferRequests } from "@/lib/actions/section-transfer";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";
import { plural } from "@/components/learners/transfer-eligibility";

const NOTE_MAX = 300;

/** Decline one or many transfer requests, with an optional note the adviser sees. */
export function DeclineRequestsDialog({
  requestIds,
  onClose,
  onDone,
}: {
  /** `null` keeps the dialog closed. */
  requestIds: string[] | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [prevIds, setPrevIds] = useState(requestIds);
  if (requestIds !== prevIds) {
    setPrevIds(requestIds);
    setNote("");
    setError(null);
  }

  const count = requestIds?.length ?? 0;

  const close = () => {
    if (!pending) onClose();
  };

  const submit = () => {
    if (!requestIds || count === 0) return;
    setError(null);
    startTransition(async () => {
      const trimmed = note.trim();
      const res = await callAction(() =>
        declineSectionTransferRequests({ requestIds, note: trimmed || undefined })
      );
      if (!res.ok) {
        toastFailure(res);
        setError(res.fieldErrors?.note ?? null);
        return;
      }
      toast.success(`${plural(res.data.declined, "request")} declined. The learners stay where they are.`);
      onClose();
      onDone();
    });
  };

  return (
    <Dialog open={requestIds !== null} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{count === 1 ? "Decline this request?" : `Decline ${count} requests?`}</DialogTitle>
          <DialogDescription>
            The learners stay in their current section. The adviser sees that the request was declined, with your
            note if you add one.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="decline-note">Note to the adviser (optional)</Label>
          <Textarea
            id="decline-note"
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            disabled={pending}
            rows={3}
            aria-invalid={error ? true : undefined}
            aria-describedby="decline-note-help"
          />
          <p id="decline-note-help" className="flex justify-between gap-2 text-xs text-muted-foreground">
            <span className={error ? "text-destructive" : undefined}>{error ?? ""}</span>
            <span className="tabular-nums">
              {note.length} / {NOTE_MAX}
            </span>
          </p>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={submit} loading={pending} loadingText="Declining…">
            {count === 1 ? "Decline request" : "Decline requests"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
