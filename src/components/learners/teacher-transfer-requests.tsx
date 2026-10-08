"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, Clock, Undo2, XCircle } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { invalidateNavWarm } from "@/components/nav-prefetcher";
import { cancelSectionTransferRequest } from "@/lib/actions/section-transfer";
import { SECTION_TRANSFER_REQUEST_STATUS_LABELS } from "@/lib/constants/enum-labels";
import type { TeacherTransferRequestRow } from "@/lib/learners/section-transfer-queries";
import { SCHOOL_TIME_ZONE } from "@/lib/date-keys";
import { callAction } from "@/lib/ui/call-action";
import { ToastedError, toastFailure } from "@/lib/ui/toast-failure";
import { cn } from "@/lib/utils";

export type CancelTransferTarget = { requestId: string; learnerName: string; toSectionName: string };

/** "Cancel the request to move X to Rosal?" — shared by the roster row menu and the strip. */
export function CancelTransferRequestConfirm({
  target,
  onClose,
}: {
  target: CancelTransferTarget | null;
  onClose: () => void;
}) {
  const router = useRouter();
  if (!target) return null;
  return (
    <ConfirmAction
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title={`Cancel the request to move ${target.learnerName} to ${target.toSectionName}?`}
      description="The learner stays in your section. You can send a new request later."
      confirmLabel="Cancel request"
      cancelLabel="Keep request"
      variant="default"
      onConfirm={async () => {
        const res = await callAction(() => cancelSectionTransferRequest({ requestId: target.requestId }));
        if (!res.ok) {
          toastFailure(res);
          throw new ToastedError(res.error);
        }
        toast.success("Transfer request withdrawn");
        invalidateNavWarm();
        router.refresh();
      }}
    />
  );
}

const STATUS_STYLE: Record<TeacherTransferRequestRow["status"], { icon: typeof Clock; className: string }> = {
  PENDING: { icon: Clock, className: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200" },
  APPROVED: { icon: CheckCircle2, className: "bg-primary/10 text-primary" },
  REJECTED: { icon: XCircle, className: "bg-destructive/10 text-destructive" },
  CANCELLED: { icon: Undo2, className: "bg-muted text-muted-foreground" },
};

function day(d: Date): string {
  return new Date(d).toLocaleDateString("en-PH", { month: "short", day: "numeric", timeZone: SCHOOL_TIME_ZONE });
}

/**
 * "Your transfer requests": waiting ones plus those decided in the last 14
 * days. It is the teacher's only notice of a decision, so a decline and its
 * note show here. Renders nothing when there is nothing to report.
 */
export function TeacherTransferRequests({
  requests,
  loadFailed = false,
}: {
  requests: TeacherTransferRequestRow[];
  loadFailed?: boolean;
}) {
  const [cancelTarget, setCancelTarget] = useState<CancelTransferTarget | null>(null);

  if (loadFailed) {
    return <p className="text-sm text-destructive">Could not load your transfer requests right now.</p>;
  }
  if (requests.length === 0) return null;

  return (
    <Surface as="section" aria-labelledby="your-transfer-requests" className="space-y-2 rounded-2xl px-3 py-3 sm:px-4">
      <h2 id="your-transfer-requests" className="text-sm font-semibold text-foreground">
        Your transfer requests
      </h2>
      <ul className="divide-y divide-border/60">
        {requests.map((r) => {
          const style = STATUS_STYLE[r.status];
          const Icon = style.icon;
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                  style.className
                )}
              >
                <Icon className="size-3.5" aria-hidden />
                {SECTION_TRANSFER_REQUEST_STATUS_LABELS[r.status]}
              </span>
              <span className="font-medium text-foreground">{r.learner.fullName}</span>
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                {r.fromSectionName}
                <ArrowRight className="size-3.5" aria-label="to" />
                {r.toSectionName}
              </span>
              <span className="text-xs text-muted-foreground">
                {r.decidedAt ? `Decided ${day(r.decidedAt)}` : `Sent ${day(r.createdAt)}`}
              </span>
              {r.status === "REJECTED" && r.decisionNote ? (
                <span className="basis-full text-xs text-foreground">School Head&apos;s note: {r.decisionNote}</span>
              ) : null}
              {r.status === "PENDING" ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  onClick={() =>
                    setCancelTarget({
                      requestId: r.id,
                      learnerName: r.learner.fullName,
                      toSectionName: r.toSectionName,
                    })
                  }
                >
                  Cancel
                  <span className="sr-only"> the request for {r.learner.fullName}</span>
                </Button>
              ) : null}
            </li>
          );
        })}
      </ul>
      <CancelTransferRequestConfirm target={cancelTarget} onClose={() => setCancelTarget(null)} />
    </Surface>
  );
}
