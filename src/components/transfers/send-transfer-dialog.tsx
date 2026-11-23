"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { SchoolTransferKind } from "@prisma/client";
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
import { requestSchoolTransfers } from "@/lib/actions/school-transfer";
import { SCHOOL_TRANSFER_KIND_SINGULAR_LABELS } from "@/lib/constants/enum-labels";
import type { TransferTarget } from "@/lib/transfers/queries";
import { TRANSFER_EXPIRY_DAYS } from "@/lib/transfers/school-transfer-rules";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";

const NOTE_MAX = 300;
export const SELECT_CLASS = "flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm lg:h-9";

export function countOf(n: number, kind: SchoolTransferKind): string {
  const word = SCHOOL_TRANSFER_KIND_SINGULAR_LABELS[kind];
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Pick the receiving school and send the ticked people. Nothing moves yet. */
export function SendTransferDialog({
  schoolId,
  kind,
  ids,
  targets,
  onClose,
  onDone,
}: {
  schoolId: string;
  kind: SchoolTransferKind;
  /** `null` keeps the dialog closed. */
  ids: string[] | null;
  targets: TransferTarget[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [toSchoolId, setToSchoolId] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [prevIds, setPrevIds] = useState(ids);
  if (ids !== prevIds) {
    setPrevIds(ids);
    setToSchoolId("");
    setReason("");
    setErrors({});
  }

  const count = ids?.length ?? 0;
  const close = () => {
    if (!pending) onClose();
  };

  const submit = () => {
    if (!ids || count === 0) return;
    if (!toSchoolId) {
      setErrors({ toSchoolId: "Choose a school" });
      return;
    }
    setErrors({});
    startTransition(async () => {
      const res = await callAction(() =>
        requestSchoolTransfers({ schoolId, toSchoolId, kind, ids, reason: reason.trim() || undefined })
      );
      if (!res.ok) {
        toastFailure(res);
        setErrors(res.fieldErrors ?? {});
        return;
      }
      const school = targets.find((t) => t.id === toSchoolId)?.name ?? "the school";
      toast.success(`${countOf(res.data.count, kind)} sent to ${school}. They move when ${school} accepts.`);
      onClose();
      onDone();
    });
  };

  return (
    <Dialog open={ids !== null} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer {countOf(count, kind)} to another school</DialogTitle>
          <DialogDescription>
            Nothing moves yet. The receiving school is told and decides. Until then the{" "}
            {count === 1 ? "person stays" : "people stay"} here, and the transfer cancels itself after{" "}
            {TRANSFER_EXPIRY_DAYS} days.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="transfer-to-school">Receiving school</Label>
            <select
              id="transfer-to-school"
              value={toSchoolId}
              onChange={(e) => setToSchoolId(e.target.value)}
              disabled={pending}
              aria-invalid={errors.toSchoolId ? true : undefined}
              aria-describedby={errors.toSchoolId ? "transfer-to-school-error" : undefined}
              className={SELECT_CLASS}
            >
              <option value="">Choose a school</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {errors.toSchoolId ? (
              <p id="transfer-to-school-error" className="text-xs text-destructive">
                {errors.toSchoolId}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="transfer-reason">Reason (optional)</Label>
            <Textarea
              id="transfer-reason"
              value={reason}
              maxLength={NOTE_MAX}
              onChange={(e) => setReason(e.target.value)}
              disabled={pending}
              rows={3}
              aria-invalid={errors.reason ? true : undefined}
              aria-describedby="transfer-reason-help"
            />
            <p id="transfer-reason-help" className="flex justify-between gap-2 text-xs text-muted-foreground">
              <span className={errors.reason ? "text-destructive" : undefined}>
                {errors.reason ?? "The receiving school sees this."}
              </span>
              <span className="tabular-nums">
                {reason.length} / {NOTE_MAX}
              </span>
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} loading={pending} loadingText="Sending…">
            Send transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
