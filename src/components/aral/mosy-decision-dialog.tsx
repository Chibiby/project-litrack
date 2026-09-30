"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { AppForm, useAppForm } from "@/components/forms/app-form";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveMosyDecision } from "@/lib/actions/aral-mosy";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";
import { ARAL_MOSY_OUTCOME_CHOICE_LABELS } from "@/lib/constants/enum-labels";
import { aralMosyDecisionSchema, MOSY_REMARKS_MAX } from "@/lib/validators/aral-mosy.schema";
import type { MosyRow } from "@/lib/aral/mosy-queries";
import type { MosyTransition } from "@/lib/aral/mosy";
import { cn } from "@/lib/utils";

export type MosyDialogState = {
  row: MosyRow;
};

type MosyFormValues = {
  learnerId: string;
  mosyLevel: string;
  decision: "" | "MOVE_OUT" | "STAY";
  reason: string;
  improvedToLevel: string;
  remarks: string;
};

const TRANSITION_TOAST: Record<MosyTransition, string> = {
  NONE: "MOSY level saved",
  MOVED_OUT: "Moved out of ARAL",
  RETAGGED: "Back in ARAL. You are now their ARAL teacher.",
};

const CHOICE_CARD =
  "flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-card p-3 transition-colors hover:bg-muted/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[[data-state=checked]]:border-violet has-[[data-state=checked]]:bg-violet-soft";

function MosyDecisionForm({
  state,
  onClose,
  onPendingChange,
}: {
  state: MosyDialogState;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { row } = state;
  const [pending, startTransition] = useTransition();
  const intent = useRef<"save" | "later">("save");

  useEffect(() => {
    onPendingChange(pending);
    return () => onPendingChange(false);
  }, [pending, onPendingChange]);

  // A tagged learner's saved MOVE_OUT must not be pre-chosen: Save would untag them.
  const initialDecision: MosyFormValues["decision"] = row.isAralLearner
    ? row.decision === "STAY"
      ? "STAY"
      : ""
    : (row.decision ?? "MOVE_OUT");

  // Only prefill when the saved choice is still offered; otherwise the teacher re-picks.
  const savedChoice =
    initialDecision === "MOVE_OUT"
      ? row.reasonChoices.find(
          (c) => c.reason === row.reason && c.improvedToLevel === (row.improvedToLevel ?? null)
        )
      : undefined;

  const form = useAppForm<MosyFormValues>({
    schema: aralMosyDecisionSchema,
    defaultValues: {
      learnerId: row.id,
      mosyLevel: row.mosyLevel ?? "",
      decision: initialDecision,
      reason: savedChoice?.reason ?? "",
      improvedToLevel: savedChoice?.improvedToLevel ?? "",
      remarks: row.remarks ?? "",
    },
  });

  const decision = form.watch("decision");
  const watchedReason = form.watch("reason");
  const watchedImprovedTo = form.watch("improvedToLevel");
  const selectedChoiceKey =
    row.reasonChoices.find(
      (c) => c.reason === watchedReason && (c.improvedToLevel ?? "") === watchedImprovedTo
    )?.key ?? "";
  const improvedToError = form.formState.errors.improvedToLevel?.message;
  const remarksLength = form.watch("remarks").length;
  const canDecideLater = row.isAralLearner && row.decision === null;
  const gradeSection = row.sectionName ? `${row.gradeLabel} - ${row.sectionName}` : row.gradeLabel;

  function send(values: MosyFormValues) {
    const fd = new FormData();
    fd.set("learnerId", values.learnerId);
    fd.set("mosyLevel", values.mosyLevel);
    fd.set("decision", values.decision);
    fd.set("reason", values.decision === "MOVE_OUT" ? values.reason : "");
    fd.set("improvedToLevel", values.decision === "MOVE_OUT" ? values.improvedToLevel : "");
    fd.set("remarks", values.remarks);

    startTransition(async () => {
      const res = await callAction(() => saveMosyDecision(fd));
      if (!res.ok) {
        if (res.fieldErrors) {
          for (const [field, message] of Object.entries(res.fieldErrors)) {
            if (field in values) {
              form.setError(field as keyof MosyFormValues, { message });
            }
          }
        }
        toastFailure(res);
        return;
      }
      toast.success(TRANSITION_TOAST[res.data.transition]);
      onClose();
    });
  }

  function onValid() {
    const values = form.getValues();
    if (intent.current === "save" && !values.decision) {
      form.setError("decision", { message: "Choose whether the learner moves out or stays in ARAL" });
      return;
    }
    send(values);
  }

  return (
    <AppForm form={form} onSubmit={onValid} className="grid gap-4">
      <DialogHeader className="pr-8">
        <DialogTitle>Move out from ARAL?</DialogTitle>
        <DialogDescription asChild>
          <div className="space-y-2">
            <p>
              <span className="font-semibold text-foreground">{row.fullName}</span>
              <span className="text-muted-foreground"> · {gradeSection}</span>
            </p>
          </div>
        </DialogDescription>
      </DialogHeader>

      <FormField
        control={form.control}
        name="decision"
        render={({ field }) => (
          <FormItem>
            <FormLabel id="mosy-decision-label">Decision</FormLabel>
            <FormControl>
              <RadioGroup
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value);
                  if (value !== "MOVE_OUT") {
                    form.setValue("reason", "");
                    form.setValue("improvedToLevel", "");
                  }
                  form.clearErrors(["decision", "reason", "improvedToLevel"]);
                }}
                aria-labelledby="mosy-decision-label"
                disabled={pending}
                className="gap-2"
              >
                {(["MOVE_OUT", "STAY"] as const).map((value) => (
                  <Label
                    key={value}
                    htmlFor={`mosy-decision-${value}`}
                    className={cn(CHOICE_CARD, "font-normal")}
                  >
                    <RadioGroupItem
                      id={`mosy-decision-${value}`}
                      value={value}
                      className="mt-0.5 shrink-0 border-violet text-violet"
                    />
                    <span className="min-w-0 space-y-0.5">
                      <span className="block text-sm font-medium text-foreground">
                        {value === "MOVE_OUT"
                          ? "Move out learner from ARAL"
                          : ARAL_MOSY_OUTCOME_CHOICE_LABELS.STAY}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {value === "MOVE_OUT"
                          ? "This removes the learner from ARAL. They stay on this page for the rest of the school year."
                          : "The learner keeps their place in the ARAL program."}
                      </span>
                    </span>
                  </Label>
                ))}
              </RadioGroup>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Re-tagging a moved-out learner makes the saving adviser their ARAL
          teacher of record (resolveMosySave), so say so before they commit. */}
      {!row.isAralLearner && decision === "STAY" ? (
        <Callout role="status" title="You will become this learner's ARAL teacher">
          Saving puts {row.fullName} back in ARAL with you as their ARAL teacher. They will
          appear in your Weekly Attendance and Monthly Reading Level.
        </Callout>
      ) : null}

      <FormField
        control={form.control}
        name="mosyLevel"
        render={({ field }) => (
          <FormItem>
            <FormLabel required>MOSY reading level</FormLabel>
            <Select
              value={field.value}
              onValueChange={(value) => {
                field.onChange(value);
                form.clearErrors("mosyLevel");
              }}
              disabled={pending}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select level" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {row.levelOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      {decision === "MOVE_OUT" ? (
        <FormField
          control={form.control}
          name="reason"
          render={() => (
            <FormItem>
              <FormLabel required>Select reason</FormLabel>
              <Select
                value={selectedChoiceKey}
                onValueChange={(key) => {
                  const choice = row.reasonChoices.find((c) => c.key === key);
                  if (!choice) return;
                  form.setValue("reason", choice.reason, { shouldDirty: true });
                  form.setValue("improvedToLevel", choice.improvedToLevel ?? "", {
                    shouldDirty: true,
                  });
                  form.clearErrors(["reason", "improvedToLevel"]);
                }}
                disabled={pending}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select reason" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {row.reasonChoices.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
              {improvedToError ? (
                <p className="text-sm font-medium text-destructive">{improvedToError}</p>
              ) : null}
            </FormItem>
          )}
        />
      ) : null}

      <FormField
        control={form.control}
        name="remarks"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Remarks (optional)</FormLabel>
            <FormControl>
              <Textarea
                {...field}
                maxLength={MOSY_REMARKS_MAX}
                rows={3}
                disabled={pending}
                placeholder="Add a short note"
              />
            </FormControl>
            <div className="flex items-start justify-between gap-2">
              <FormMessage />
              <p
                className="ml-auto text-xs tabular-nums text-muted-foreground"
                aria-live="polite"
              >
                {remarksLength}/{MOSY_REMARKS_MAX}
              </p>
            </div>
          </FormItem>
        )}
      />

      <DialogFooter className="sm:items-center">
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        {canDecideLater ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => {
              form.setValue("decision", "");
              form.setValue("reason", "");
              form.setValue("improvedToLevel", "");
              intent.current = "later";
              void form.handleSubmit(onValid)();
            }}
          >
            Decide later
          </Button>
        ) : null}
        <Button type="submit" disabled={pending} onClick={() => (intent.current = "save")}>
          {pending ? "Saving…" : "Save MOSY Decision"}
        </Button>
      </DialogFooter>
    </AppForm>
  );
}

/**
 * "Move out from ARAL?" — the only place a MOSY level or decision is saved.
 * Closing it any way (Cancel, Escape, the X) discards the draft; nothing is
 * written until Save.
 */
export function MosyDecisionDialog({
  state,
  onClose,
}: {
  state: MosyDialogState | null;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);

  return (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => (open || pending ? undefined : onClose())}
    >
      <DialogContent
        showClose={!pending}
        className="max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-lg overflow-y-auto p-4 sm:p-6"
      >
        {state ? (
          <MosyDecisionForm
            key={state.row.id}
            state={state}
            onClose={onClose}
            onPendingChange={setPending}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
