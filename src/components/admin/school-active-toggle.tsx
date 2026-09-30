"use client";

import { useOptimistic, useState, useTransition } from "react";
import { ConfirmAction } from "@/components/confirm-action";
import { Button } from "@/components/ui/button";
import { setSchoolActive } from "@/lib/actions/school-management";
import { runOptimistic, settleActionResult } from "@/lib/ui/optimistic";

export function SchoolActiveToggle({
  schoolId,
  isActive,
  schoolName,
  onToggle,
  pending: pendingProp,
  className,
}: {
  schoolId: string;
  isActive: boolean;
  schoolName: string;
  /** Parent-owned optimistic mutation (table). */
  onToggle?: (nextActive: boolean) => void | Promise<void>;
  pending?: boolean;
  className?: string;
}) {
  const [optimisticActive, setOptimisticActive] = useOptimistic(isActive);
  const [localPending, startTransition] = useTransition();
  const pending = pendingProp ?? localPending;
  const shownActive = onToggle ? isActive : optimisticActive;
  /**
   * Which way the click was headed. The optimistic flag flips the moment the
   * transition starts, so `shownActive` already reads as the *new* state and
   * cannot say whether we are activating or deactivating.
   */
  const [busyNext, setBusyNext] = useState<boolean | null>(null);

  const runStandalone = (next: boolean) =>
    runOptimistic(startTransition, async () => {
      setOptimisticActive(next);
      const fd = new FormData();
      fd.set("schoolId", schoolId);
      fd.set("isActive", next ? "true" : "false");
      const res = await setSchoolActive(fd);
      await settleActionResult(
        res,
        next ? "School activated" : "School deactivated"
      );
    });

  const next = !shownActive;

  return (
    <ConfirmAction
      variant={next ? "default" : "destructive"}
      title={next ? `Activate ${schoolName}?` : `Deactivate ${schoolName}?`}
      description={
        next
          ? `The School Head and teachers at ${schoolName} will be able to sign in again.`
          : `Everyone at ${schoolName} (School Head and teachers) will be blocked from signing in until the school is reactivated. No data is changed.`
      }
      confirmLabel={next ? "Activate school" : "Deactivate school"}
      trigger={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={className}
          loading={pending}
          loadingText={
            busyNext === null
              ? undefined
              : busyNext
                ? "Activating…"
                : "Deactivating…"
          }
          title={shownActive ? "Deactivate school" : "Activate school"}
        >
          {shownActive ? "Deactivate" : "Activate"}
        </Button>
      }
      onConfirm={() => {
        setBusyNext(next);
        const handle = onToggle
          ? () => Promise.resolve(onToggle(next))
          : () => runStandalone(next);
        void handle()
          .catch(() => {
            /* toast already shown */
          })
          .finally(() => setBusyNext(null));
      }}
    />
  );
}
