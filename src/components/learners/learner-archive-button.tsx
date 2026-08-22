"use client";

import { useOptimistic, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { Archive, ArchiveRestore } from "lucide-react";
import { archiveLearner, restoreLearner } from "@/lib/actions/learner";
import { invalidateNavWarm } from "@/components/nav-prefetcher";
import { runOptimistic, settleActionResult } from "@/lib/ui/optimistic";

type Props = {
  learnerId: string;
  archived: boolean;
  /**
   * When provided (list parent), parent owns mutation + list optimism.
   */
  onArchiveChange?: () => void | Promise<void>;
  pending?: boolean;
};

export function LearnerArchiveButton({
  learnerId,
  archived,
  onArchiveChange,
  pending: pendingProp,
}: Props) {
  const [optimisticArchived, setOptimisticArchived] = useOptimistic(archived);
  const [localPending, startTransition] = useTransition();
  const pending = pendingProp ?? localPending;
  const shownArchived = onArchiveChange ? archived : optimisticArchived;

  const runStandaloneRestore = () =>
    runOptimistic(startTransition, async () => {
      setOptimisticArchived(false);
      const fd = new FormData();
      fd.set("id", learnerId);
      const res = await restoreLearner(fd);
      await settleActionResult(res, "Learner restored");
      invalidateNavWarm();
    });

  const runStandaloneArchive = () =>
    runOptimistic(startTransition, async () => {
      setOptimisticArchived(true);
      const fd = new FormData();
      fd.set("id", learnerId);
      const res = await archiveLearner(fd);
      await settleActionResult(res, "Learner archived");
      invalidateNavWarm();
    });

  if (shownArchived) {
    const handle = onArchiveChange ?? runStandaloneRestore;
    return (
      <Button
        size="sm"
        variant="outline"
        loading={pending}
        loadingText="Restoring…"
        onClick={() => {
          void Promise.resolve(handle()).catch(() => {
            /* toast already shown */
          });
        }}
      >
        <ArchiveRestore className="h-4 w-4" />
        Restore
      </Button>
    );
  }

  const handle = onArchiveChange ?? runStandaloneArchive;
  return (
    <ConfirmAction
      title="Archive learner?"
      description="They will be hidden from active lists and can be restored later."
      confirmLabel="Archive"
      variant="destructive"
      disabled={pending}
      trigger={
        <Button size="sm" variant="outline" loading={pending} loadingText="Archiving…">
          <Archive className="h-4 w-4" />
          Archive
        </Button>
      }
      onConfirm={handle}
    />
  );
}
