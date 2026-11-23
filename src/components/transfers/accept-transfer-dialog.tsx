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
import { acceptSchoolTransfers, declineSchoolTransfers } from "@/lib/actions/school-transfer";
import type { PlacementOptions } from "@/lib/transfers/queries";
import { SKIP_REASON_LABELS, type SkipReason } from "@/lib/transfers/school-transfer-rules";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";
import { countOf, SELECT_CLASS } from "./send-transfer-dialog";

const NOTE_MAX = 300;

/** "1 skipped: Expired before it was answered." — one clause per reason. */
export function skippedSentence(skipped: { reason: SkipReason }[]): string | null {
  if (skipped.length === 0) return null;
  const byReason = new Map<SkipReason, number>();
  for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
  return [...byReason].map(([reason, n]) => `${n} skipped: ${SKIP_REASON_LABELS[reason]}.`).join(" ");
}

/**
 * Accept incoming transfers. Learners need a grade and section here (the
 * section's adviser becomes theirs); staff join this school as they are.
 */
export function AcceptTransferDialog({
  schoolId,
  kind,
  ids,
  placement,
  onClose,
  onDone,
}: {
  schoolId: string;
  kind: SchoolTransferKind;
  ids: string[] | null;
  placement: PlacementOptions;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [gradeLevelId, setGradeLevelId] = useState("");
  const [sectionId, setSectionId] = useState("");

  const [prevIds, setPrevIds] = useState(ids);
  if (ids !== prevIds) {
    setPrevIds(ids);
    setGradeLevelId("");
    setSectionId("");
  }

  const learner = kind === "LEARNER";
  const count = ids?.length ?? 0;
  const grade = placement.grades.find((g) => g.id === gradeLevelId);
  const section = grade?.sections.find((s) => s.id === sectionId);
  const ready = !learner || Boolean(grade && section);

  const close = () => {
    if (!pending) onClose();
  };

  const submit = () => {
    if (!ids || count === 0 || !ready) return;
    startTransition(async () => {
      const res = await callAction(() =>
        acceptSchoolTransfers({
          schoolId,
          ids,
          placement: learner ? { gradeLevelId, sectionId } : undefined,
        })
      );
      if (!res.ok) {
        toastFailure(res);
        return;
      }
      const skipped = skippedSentence(res.data.skipped);
      const done = res.data.accepted > 0 ? `${countOf(res.data.accepted, kind)} joined your school.` : "Nobody moved.";
      if (res.data.accepted > 0) toast.success(skipped ? `${done} ${skipped}` : done);
      else toast.warning(skipped ? `${done} ${skipped}` : done);
      onClose();
      onDone();
    });
  };

  return (
    <Dialog open={ids !== null} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Accept {countOf(count, kind)}?</DialogTitle>
          <DialogDescription>
            {learner
              ? "They move to your school now, with their attendance, reading levels and grades. The other school keeps a read-only copy."
              : "They join your school now. Their advisory and ARAL learners at the other school stay there. Next time they sign in, they choose your school."}
          </DialogDescription>
        </DialogHeader>
        {learner ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="accept-grade">Grade</Label>
              <select
                id="accept-grade"
                value={gradeLevelId}
                onChange={(e) => {
                  setGradeLevelId(e.target.value);
                  setSectionId("");
                }}
                disabled={pending}
                className={SELECT_CLASS}
              >
                <option value="">Choose a grade</option>
                {placement.grades.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="accept-section">Section</Label>
              <select
                id="accept-section"
                value={sectionId}
                onChange={(e) => setSectionId(e.target.value)}
                disabled={pending || !grade || grade.sections.length === 0}
                aria-describedby="accept-section-help"
                className={SELECT_CLASS}
              >
                <option value="">
                  {!grade ? "Choose a grade first" : grade.sections.length === 0 ? "No sections in this grade" : "Choose a section"}
                </option>
                {grade?.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <p id="accept-section-help" className="text-xs text-muted-foreground">
                {section
                  ? section.adviserName
                    ? `Adviser: ${section.adviserName}`
                    : "No adviser yet. The learners have no adviser until one is assigned."
                  : count > 1
                    ? "Every learner you accept here goes to this section."
                    : " "}
              </p>
            </div>
          </div>
        ) : null}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={!ready} loading={pending} loadingText="Accepting…">
            Accept
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Decline incoming transfers, with an optional note the sending school sees. */
export function DeclineTransferDialog({
  schoolId,
  kind,
  ids,
  onClose,
  onDone,
}: {
  schoolId: string;
  kind: SchoolTransferKind;
  ids: string[] | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [prevIds, setPrevIds] = useState(ids);
  if (ids !== prevIds) {
    setPrevIds(ids);
    setNote("");
    setError(null);
  }

  const count = ids?.length ?? 0;
  const close = () => {
    if (!pending) onClose();
  };

  const submit = () => {
    if (!ids || count === 0) return;
    setError(null);
    startTransition(async () => {
      const res = await callAction(() =>
        declineSchoolTransfers({ schoolId, ids, note: note.trim() || undefined })
      );
      if (!res.ok) {
        toastFailure(res);
        setError(res.fieldErrors?.note ?? null);
        return;
      }
      toast.success(`${countOf(res.data.count, kind)} declined. They stay at their school.`);
      onClose();
      onDone();
    });
  };

  return (
    <Dialog open={ids !== null} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Decline {countOf(count, kind)}?</DialogTitle>
          <DialogDescription>
            They stay at their school. The sending school sees that you declined, with your note if you add one.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="decline-transfer-note">Note to the sending school (optional)</Label>
          <Textarea
            id="decline-transfer-note"
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            disabled={pending}
            rows={3}
            aria-invalid={error ? true : undefined}
            aria-describedby="decline-transfer-note-help"
          />
          <p id="decline-transfer-note-help" className="flex justify-between gap-2 text-xs text-muted-foreground">
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
            Decline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
