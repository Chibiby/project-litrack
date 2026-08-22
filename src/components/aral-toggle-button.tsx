"use client";

import { useOptimistic, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { Sparkles } from "lucide-react";
import { toggleAralLearner } from "@/lib/actions/learner";
import { invalidateNavWarm } from "@/components/nav-prefetcher";
import { runOptimistic, settleActionResult } from "@/lib/ui/optimistic";

type Props = {
  learnerId: string;
  isAral: boolean;
  /**
   * When provided (list parent), the parent owns the mutation + list optimism.
   * The button only renders UI and invokes this callback.
   */
  onToggle?: () => void | Promise<void>;
  pending?: boolean;
};

export function AralToggleButton({
  learnerId,
  isAral,
  onToggle,
  pending: pendingProp,
}: Props) {
  const [optimisticAral, setOptimisticAral] = useOptimistic(isAral);
  const [localPending, startTransition] = useTransition();
  const pending = pendingProp ?? localPending;
  const shownAral = onToggle ? isAral : optimisticAral;

  const runStandalone = () => {
    const wasAral = optimisticAral;
    return runOptimistic(startTransition, async () => {
      setOptimisticAral(!wasAral);
      const fd = new FormData();
      fd.set("learnerId", learnerId);
      const res = await toggleAralLearner(fd);
      await settleActionResult(
        res,
        wasAral ? "Removed from ARAL" : "Marked as ARAL learner"
      );
      invalidateNavWarm();
    });
  };

  const handle = onToggle ?? runStandalone;

  if (shownAral) {
    return (
      <ConfirmAction
        title="Remove from ARAL?"
        description="This learner will leave the ARAL list. You can mark them again later if needed."
        confirmLabel="Remove"
        variant="destructive"
        disabled={pending}
        trigger={
          <Button
            size="sm"
            variant="default"
            className="bg-violet hover:bg-violet/90"
            loading={pending}
            loadingText="Updating…"
          >
            <Sparkles className="h-4 w-4" />
            ARAL ✓
          </Button>
        }
        onConfirm={handle}
      />
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      loading={pending}
      loadingText="Marking…"
      onClick={() => {
        void Promise.resolve(handle()).catch(() => {
          /* toast already shown */
        });
      }}
    >
      <Sparkles className="h-4 w-4" />
      Mark ARAL
    </Button>
  );
}
