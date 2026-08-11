"use client";

import { useOptimistic, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setSchoolActive } from "@/lib/actions/school-management";
import { runOptimistic, settleActionResult } from "@/lib/ui/optimistic";

export function SchoolActiveToggle({
  schoolId,
  isActive,
  schoolName,
  onToggle,
  pending: pendingProp,
}: {
  schoolId: string;
  isActive: boolean;
  schoolName: string;
  /** Parent-owned optimistic mutation (table). */
  onToggle?: (nextActive: boolean) => void | Promise<void>;
  pending?: boolean;
}) {
  const [optimisticActive, setOptimisticActive] = useOptimistic(isActive);
  const [localPending, startTransition] = useTransition();
  const pending = pendingProp ?? localPending;
  const shownActive = onToggle ? isActive : optimisticActive;

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

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      title={shownActive ? "Deactivate school" : "Activate school"}
      onClick={() => {
        const next = !shownActive;
        if (
          !window.confirm(
            next
              ? `Activate ${schoolName}?`
              : `Deactivate ${schoolName}? Login for this school will be blocked while inactive.`
          )
        ) {
          return;
        }
        const handle = onToggle
          ? () => Promise.resolve(onToggle(next))
          : () => runStandalone(next);
        void handle().catch(() => {
          /* toast already shown */
        });
      }}
    >
      {shownActive ? "Deactivate" : "Activate"}
    </Button>
  );
}
