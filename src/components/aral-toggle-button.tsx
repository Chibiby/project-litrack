"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { Sparkles } from "lucide-react";
import { toggleAralLearner } from "@/lib/actions/learner";
import { invalidateNavWarm } from "@/components/nav-prefetcher";

export function AralToggleButton({ learnerId, isAral }: { learnerId: string; isAral: boolean }) {
  const [pending, startTransition] = useTransition();

  const runToggle = async () => {
    const fd = new FormData();
    fd.set("learnerId", learnerId);
    const res = await toggleAralLearner(fd);
    if (res.ok) {
      toast.success(isAral ? "Removed from ARAL" : "Marked as ARAL learner");
      invalidateNavWarm();
    } else {
      toast.error(res.error);
      throw new Error(res.error);
    }
  };

  if (isAral) {
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
            disabled={pending}
          >
            <Sparkles className="h-4 w-4" />
            {pending ? "Updating…" : "ARAL ✓"}
          </Button>
        }
        onConfirm={runToggle}
      />
    );
  }

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        startTransition(async () => {
          try {
            await runToggle();
          } catch {
            /* toast already shown */
          }
        });
      }}
    >
      <Sparkles className="h-4 w-4" />
      {pending ? "Marking…" : "Mark ARAL"}
    </Button>
  );
}
