"use client";

import { useOptimistic, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { Archive, ArchiveRestore } from "lucide-react";
import { archiveLearner, restoreLearner } from "@/lib/actions/learner";
import {
  archiveConfirmDescription,
  archiveConfirmLabel,
  archiveConfirmTitle,
} from "@/components/learners/archive-confirm-copy";
import { invalidateNavWarm } from "@/components/nav-prefetcher";
import { runOptimistic, settleActionResult } from "@/lib/ui/optimistic";

type Props = {
  learnerId: string;
  /** Named in the confirm; without it the confirm says "The learner". */
  learnerName?: string;
  /** Adds the ARAL consequence to the confirm. */
  isAralLearner?: boolean;
  archived: boolean;
  /**
   * When provided (list parent), parent owns mutation + list optimism.
   */
  onArchiveChange?: () => void | Promise<void>;
  pending?: boolean;
};

export function LearnerArchiveButton({
  learnerId,
  learnerName,
  isAralLearner = false,
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
  const target = {
    ids: [learnerId],
    name: learnerName ?? null,
    aralCount: isAralLearner ? 1 : 0,
  };
  return (
    <ConfirmAction
      title={archiveConfirmTitle(target)}
      description={archiveConfirmDescription(target)}
      confirmLabel={archiveConfirmLabel(target)}
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
