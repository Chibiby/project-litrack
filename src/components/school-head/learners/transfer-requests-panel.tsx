"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, Check, Inbox, X } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmAction } from "@/components/confirm-action";
import { invalidateNavWarm } from "@/components/nav-prefetcher";
import { approveSectionTransferRequests } from "@/lib/actions/section-transfer";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { TRANSFER_BLOCK_REASON_LABELS } from "@/lib/learners/section-transfer";
import type { PendingTransferRequestRow } from "@/lib/learners/section-transfer-queries";
import { SCHOOL_TIME_ZONE } from "@/lib/date-keys";
import { callAction } from "@/lib/ui/call-action";
import { ToastedError, toastFailure } from "@/lib/ui/toast-failure";
import { cn } from "@/lib/utils";
import { DeclineRequestsDialog } from "./decline-requests-dialog";
import { plural } from "@/components/learners/transfer-eligibility";

export const READ_ONLY_CAPTION = "Only the School Head can transfer learners or decide requests.";

function when(d: Date): string {
  return new Date(d).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: SCHOOL_TIME_ZONE });
}

function gradeOf(r: PendingTransferRequestRow): string {
  return GRADE_LEVEL_LABELS[r.learner.gradeType] ?? r.learner.gradeType;
}

/**
 * Teachers' waiting transfer requests, oldest first, above the School Head's
 * learner directory. A request an approval would refuse is flagged with why,
 * and left out of a bulk approve; it can still be declined.
 */
export function TransferRequestsPanel({
  requests,
  readOnly,
  loadFailed = false,
  totalCount,
}: {
  requests: PendingTransferRequestRow[];
  readOnly: boolean;
  loadFailed?: boolean;
  /** Every waiting request in the school; above `requests.length` the list is cut to the oldest. */
  totalCount?: number;
}) {
  const truncated = totalCount !== undefined && totalCount > requests.length;
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [approveIds, setApproveIds] = useState<string[] | null>(null);
  const [declineIds, setDeclineIds] = useState<string[] | null>(null);
  const [, startTransition] = useTransition();

  const [prevRequests, setPrevRequests] = useState(requests);
  if (requests !== prevRequests) {
    setPrevRequests(requests);
    const live = new Set(requests.map((r) => r.id));
    setSelected((prev) => new Set([...prev].filter((id) => live.has(id))));
  }

  const picked = requests.filter((r) => selected.has(r.id));
  const approvable = picked.filter((r) => r.staleReason === null);
  const staleInPick = picked.length - approvable.length;

  const settle = () => {
    setSelected(new Set());
    startTransition(() => {
      invalidateNavWarm();
      router.refresh();
    });
  };

  const approve = async (ids: string[]) => {
    const res = await callAction(() => approveSectionTransferRequests({ requestIds: ids }));
    if (!res.ok) {
      toastFailure(res);
      throw new ToastedError(res.error);
    }
    toast.success(`${plural(res.data.approved, "request")} approved. The learners have moved.`);
    settle();
  };

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <Surface
      as="section"
      id="transfer-requests"
      aria-labelledby="transfer-requests-heading"
      className="scroll-mt-24 space-y-3 rounded-2xl px-3 py-4 sm:px-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="transfer-requests-heading" className="text-base font-semibold">
          Transfer requests{" "}
          {requests.length > 0 ? <span className="text-muted-foreground">({requests.length})</span> : null}
        </h2>
        {!readOnly && requests.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              disabled={approvable.length === 0}
              onClick={() => setApproveIds(approvable.map((r) => r.id))}
            >
              Approve selected ({approvable.length})
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={picked.length === 0}
              onClick={() => setDeclineIds(picked.map((r) => r.id))}
            >
              Decline selected ({picked.length})
            </Button>
          </div>
        ) : null}
      </div>

      {readOnly ? <p className="text-xs text-muted-foreground">{READ_ONLY_CAPTION}</p> : null}
      {truncated ? (
        <p className="text-xs text-muted-foreground">
          Showing the oldest {requests.length} of {totalCount} requests. Approve or decline these to see the rest.
        </p>
      ) : null}
      {staleInPick > 0 ? (
        <p className="text-xs text-amber-800 dark:text-amber-300">
          {plural(staleInPick, "flagged request")} {staleInPick === 1 ? "is" : "are"} left out of Approve selected.
          Decline {staleInPick === 1 ? "it" : "them"} instead.
        </p>
      ) : null}

      {loadFailed ? (
        <p className="text-sm text-destructive">Could not load transfer requests right now.</p>
      ) : requests.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Inbox className="size-4" aria-hidden />
          No transfer requests waiting.
        </p>
      ) : (
        <ul className="divide-y divide-border/60" aria-label="Waiting transfer requests">
          {!readOnly ? (
            <li className="flex items-center gap-3 pb-2">
              <Checkbox
                checked={
                  picked.length === requests.length ? true : picked.length > 0 ? "indeterminate" : false
                }
                onCheckedChange={(v) => setSelected(v === true ? new Set(requests.map((r) => r.id)) : new Set())}
                aria-label="Select all transfer requests"
              />
              <span className="text-xs text-muted-foreground">Select all</span>
            </li>
          ) : null}
          {requests.map((r) => (
            <RequestRow
              key={r.id}
              r={r}
              readOnly={readOnly}
              checked={selected.has(r.id)}
              onToggle={(on) => toggle(r.id, on)}
              onApprove={() => setApproveIds([r.id])}
              onDecline={() => setDeclineIds([r.id])}
            />
          ))}
        </ul>
      )}

      {approveIds ? (
        <ConfirmAction
          open
          onOpenChange={(next) => {
            if (!next) setApproveIds(null);
          }}
          title={approveIds.length === 1 ? "Approve this transfer?" : `Approve ${approveIds.length} transfers?`}
          description={`The ${approveIds.length === 1 ? "learner moves" : "learners move"} to the requested section now and take that section's adviser. Attendance, reading levels and grades go with them.`}
          confirmLabel="Approve and transfer"
          variant="default"
          onConfirm={() => approve(approveIds)}
        />
      ) : null}

      <DeclineRequestsDialog
        requestIds={declineIds}
        onClose={() => setDeclineIds(null)}
        onDone={settle}
      />
    </Surface>
  );
}

function RequestRow({
  r,
  readOnly,
  checked,
  onToggle,
  onApprove,
  onDecline,
}: {
  r: PendingTransferRequestRow;
  readOnly: boolean;
  checked: boolean;
  onToggle: (on: boolean) => void;
  onApprove: () => void;
  onDecline: () => void;
}) {
  return (
    <li
      id={`transfer-request-${r.id}`}
      className={cn(
        "flex scroll-mt-24 flex-col gap-2 py-3 target:bg-amber-50/60 lg:flex-row lg:items-start lg:gap-4 dark:target:bg-amber-950/30",
        checked && "bg-muted/40"
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {readOnly ? null : (
          <span className="pt-0.5">
            <Checkbox
              checked={checked}
              onCheckedChange={(v) => onToggle(v === true)}
              aria-label={`Select the request for ${r.learner.fullName}`}
            />
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-foreground">
            {r.learner.fullName} <span className="font-normal text-muted-foreground">· {gradeOf(r)}</span>
          </p>
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-foreground">
            {r.fromSection.name}
            <ArrowRight className="size-3.5 text-muted-foreground" aria-label="to" />
            {r.toSection.name}
            <span className="text-xs text-muted-foreground">
              {r.toSection.adviser ? `Adviser: ${r.toSection.adviser.fullName}` : "No adviser yet"}
            </span>
          </p>
          <p className="text-xs text-muted-foreground">
            Requested by {r.requestedBy?.fullName ?? "a former teacher"} · {when(r.createdAt)}
          </p>
          {r.reason ? <p className="text-xs text-foreground">Note: {r.reason}</p> : null}
          {r.staleReason ? (
            <p className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
              <AlertTriangle className="size-3.5" aria-hidden />
              Can&apos;t approve: {TRANSFER_BLOCK_REASON_LABELS[r.staleReason]}
            </p>
          ) : null}
        </div>
      </div>
      {readOnly ? null : (
        <div className="flex shrink-0 gap-2 pl-7 lg:pl-0">
          <Button
            type="button"
            size="sm"
            disabled={r.staleReason !== null}
            title={r.staleReason ? "This request can no longer go ahead. Decline it instead." : undefined}
            onClick={onApprove}
            aria-label={`Approve the transfer of ${r.learner.fullName}`}
          >
            <Check className="size-4" aria-hidden />
            Approve
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onDecline}
            aria-label={`Decline the transfer of ${r.learner.fullName}`}
          >
            <X className="size-4" aria-hidden />
            Decline
          </Button>
        </div>
      )}
    </li>
  );
}
