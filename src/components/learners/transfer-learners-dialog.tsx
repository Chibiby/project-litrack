"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { invalidateNavWarm } from "@/components/nav-prefetcher";
import {
  requestSectionTransfers,
  transferLearnersToSection,
} from "@/lib/actions/section-transfer";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";
import { cn } from "@/lib/utils";
import {
  LEFT_OUT_LABELS,
  destinationVerdict,
  learnerVerdict,
  plural,
  type TransferCandidate,
  type TransferDestination,
} from "@/components/learners/transfer-eligibility";

const NOTE_MAX = 300;

export type TransferLearnersDialogProps = {
  /** `transfer` moves now (School Head); `request` asks the School Head (teacher). */
  mode: "transfer" | "request";
  candidates: TransferCandidate[];
  /** Live sections of the candidates' grades, from `listTransferDestinations`. */
  destinations: TransferDestination[];
  /** Request mode: the sections the teacher advises. */
  advisedSectionIds?: string[];
  open: boolean;
  onClose: () => void;
  /** Ran after the server confirmed: the host clears its selection here. */
  onDone: () => void;
};

export function TransferLearnersDialog({
  mode,
  candidates,
  destinations,
  advisedSectionIds,
  open,
  onClose,
  onDone,
}: TransferLearnersDialogProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [sectionId, setSectionId] = useState("");
  const [note, setNote] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [raceError, setRaceError] = useState<string | null>(null);

  // Each opening starts empty: a section is a placement decision, never carried
  // over from the last dialog.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSectionId("");
      setNote("");
      setFieldError(null);
      setRaceError(null);
    }
  }

  const isRequest = mode === "request";
  const judged = candidates.map((c) => ({ c, v: learnerVerdict(c, advisedSectionIds) }));
  const eligible = judged.filter((j) => j.v.ok).map((j) => j.c);
  const leftOut = judged.flatMap((j) => (j.v.ok ? [] : [{ c: j.c, reason: j.v.reason }]));

  const gradeIds = [...new Set(eligible.map((c) => c.gradeLevelId))];
  const gradeLabels = gradeIds.map(
    (id) => eligible.find((c) => c.gradeLevelId === id)?.gradeLabel ?? ""
  );
  const mixedGrades = gradeIds.length > 1;
  const gradeId = gradeIds[0] ?? null;

  const options = gradeId ? destinations.filter((d) => d.gradeLevelId === gradeId) : [];
  const sharedSection =
    eligible.length > 0 && eligible.every((c) => c.sectionId === eligible[0].sectionId)
      ? eligible[0].sectionId
      : null;
  const chosen = options.find((d) => d.id === sectionId) ?? null;
  const pickable = options.filter((d) => d.adviser && d.id !== sharedSection);

  const verdicts = chosen ? eligible.map((c) => destinationVerdict(c, chosen, advisedSectionIds)) : [];
  const unchanged = verdicts.filter((v) => v.ok && v.kind === "unchanged").length;
  const moving = chosen ? verdicts.filter((v) => v.ok && v.kind === "move").length : eligible.length;

  const canChoose = !mixedGrades && eligible.length > 0;

  const submitLabel = isRequest
    ? moving === 1
      ? "Request transfer"
      : `Request transfer for ${moving} learners`
    : moving === 1
      ? "Transfer learner"
      : `Transfer ${moving} learners`;

  const close = () => {
    if (!pending) onClose();
  };

  const finish = (message: string) => {
    toast.success(message);
    onDone();
    onClose();
    invalidateNavWarm();
    router.refresh();
  };

  const handleSubmit = () => {
    if (!chosen || moving === 0) return;
    const learnerIds = eligible.map((c) => c.id);
    setFieldError(null);
    setRaceError(null);
    startTransition(async () => {
      if (isRequest) {
        const reason = note.trim();
        const res = await callAction(() =>
          requestSectionTransfers({ learnerIds, toSectionId: chosen.id, reason: reason || undefined })
        );
        if (!res.ok) {
          toastFailure(res);
          setFieldError(res.fieldErrors?.toSectionId ?? null);
          if (res.code.startsWith("TRANSFER_")) setRaceError(res.error);
          return;
        }
        const n = res.data.requested;
        finish(
          n > 0
            ? `Transfer requested for ${plural(n, "learner")}. Waiting for your School Head.`
            : `Already in ${chosen.name} — nothing to request.`
        );
        return;
      }
      const res = await callAction(() =>
        transferLearnersToSection({ learnerIds, toSectionId: chosen.id })
      );
      if (!res.ok) {
        toastFailure(res);
        setFieldError(res.fieldErrors?.toSectionId ?? null);
        if (res.code.startsWith("TRANSFER_")) setRaceError(res.error);
        return;
      }
      const { moved, sectionName } = res.data;
      finish(
        moved > 0
          ? `${plural(moved, "learner")} moved to ${sectionName}`
          : `Already in ${sectionName} — nothing changed`
      );
    });
  };

  const title = isRequest
    ? eligible.length === 1
      ? `Request a transfer for ${eligible[0].name}`
      : "Request a section transfer"
    : eligible.length === 1
      ? `Transfer ${eligible[0].name}`
      : "Transfer learners to another section";

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-4 overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ArrowRightLeft className="h-5 w-5" aria-hidden />
          </span>
          <DialogTitle className="mt-3">{title}</DialogTitle>
          <DialogDescription>
            {isRequest
              ? "Pick a section in the same grade. Your School Head approves or declines the request."
              : "Pick a section in the same grade. The learners take that section's adviser."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {mixedGrades ? (
            <Callout title="Choose learners from one grade">
              These learners are in {joinWords(gradeLabels)}. A transfer stays inside one grade.
              Filter by grade and select again.
            </Callout>
          ) : eligible.length === 0 ? (
            <Callout title="None of these learners can move">
              Each one is listed below with the reason.
            </Callout>
          ) : (
            <SectionChoice
              options={options}
              sharedSection={sharedSection}
              value={sectionId}
              onChange={(v) => {
                setSectionId(v);
                setFieldError(null);
              }}
              disabled={pending}
              isRequest={isRequest}
              error={fieldError}
              noneLeft={pickable.length === 0}
            />
          )}

          {leftOut.length > 0 ? <LeftOutList rows={leftOut} othersGo={canChoose} /> : null}

          {canChoose && isRequest ? (
            <div className="space-y-1.5">
              <Label htmlFor="transfer-note">Note for your School Head (optional)</Label>
              <Textarea
                id="transfer-note"
                value={note}
                maxLength={NOTE_MAX}
                onChange={(e) => setNote(e.target.value)}
                disabled={pending}
                aria-describedby="transfer-note-count"
                rows={3}
              />
              <p id="transfer-note-count" className="text-right text-xs tabular-nums text-muted-foreground">
                {note.length} / {NOTE_MAX}
              </p>
            </div>
          ) : null}

          {canChoose && chosen ? (
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-foreground" aria-live="polite">
              {isRequest
                ? `Sends ${plural(moving, "request")} to your School Head. The learners stay in your section until it is approved.`
                : `Moves ${plural(moving, "learner")} to ${chosen.name}. Their adviser becomes ${
                    chosen.adviser?.fullName ?? "that section's adviser"
                  }. Attendance, reading levels and grades go with them.`}
              {unchanged > 0 ? ` ${unchanged} already in ${chosen.name} stay where they are.` : ""}
            </p>
          ) : null}

          {raceError ? (
            <Callout title="The list has changed">
              <p>{raceError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={() => {
                  setRaceError(null);
                  router.refresh();
                }}
              >
                Refresh list
              </Button>
            </Callout>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={close} disabled={pending}>
            {canChoose ? "Cancel" : "Close"}
          </Button>
          {canChoose ? (
            <Button
              type="button"
              onClick={handleSubmit}
              loading={pending}
              loadingText={isRequest ? "Sending…" : "Transferring…"}
              disabled={!chosen || moving === 0}
            >
              {submitLabel}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

function SectionChoice({
  options,
  sharedSection,
  value,
  onChange,
  disabled,
  isRequest,
  error,
  noneLeft,
}: {
  options: TransferDestination[];
  sharedSection: string | null;
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
  isRequest: boolean;
  error: string | null;
  noneLeft: boolean;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium text-foreground">Move to section</legend>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">This grade has no sections yet.</p>
      ) : (
        <RadioGroup
          value={value}
          onValueChange={onChange}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "transfer-section-error" : undefined}
        >
          {options.map((d) => {
            const current = d.id === sharedSection;
            const blocked = current || !d.adviser;
            const itemId = `transfer-section-${d.id}`;
            return (
              <label
                key={d.id}
                htmlFor={itemId}
                className={cn(
                  "flex items-start gap-3 rounded-lg border border-border px-3 py-2.5",
                  blocked ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/50",
                  value === d.id && "border-primary bg-primary/5"
                )}
              >
                <RadioGroupItem id={itemId} value={d.id} disabled={blocked} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">
                    {d.name}
                    {current ? (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">Current section</span>
                    ) : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {d.adviser
                      ? `Adviser: ${d.adviser.fullName}`
                      : isRequest
                        ? "No adviser yet"
                        : "No adviser yet — assign one in School Setup"}
                  </span>
                </span>
              </label>
            );
          })}
        </RadioGroup>
      )}
      {noneLeft && options.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          No other section in this grade can take learners right now.
        </p>
      ) : null}
      {error ? (
        <p id="transfer-section-error" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

function LeftOutList({
  rows,
  othersGo,
}: {
  rows: { c: TransferCandidate; reason: keyof typeof LEFT_OUT_LABELS }[];
  othersGo: boolean;
}) {
  return (
    <section aria-label="Left out" className="rounded-lg border border-border/80 bg-muted/30 px-3 py-2">
      <h3 className="text-sm font-medium text-foreground">Left out ({rows.length})</h3>
      <p className="text-xs text-muted-foreground">
        {othersGo ? "These stay where they are. The rest go ahead." : "These stay where they are."}
      </p>
      <ul className="mt-1.5 max-h-32 space-y-1 overflow-y-auto text-sm">
        {rows.map(({ c, reason }) => (
          <li key={c.id} className="flex flex-wrap justify-between gap-x-3">
            <span className="text-foreground">{c.name}</span>
            <span className="text-xs text-muted-foreground">{LEFT_OUT_LABELS[reason]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
