"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { toggleAralLearner } from "@/lib/actions/learner";
import { invalidateNavWarm } from "@/components/nav-prefetcher";

export function AralToggleButton({ learnerId, isAral }: { learnerId: string; isAral: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant={isAral ? "default" : "outline"}
      className={isAral ? "bg-violet hover:bg-violet/90" : ""}
      disabled={pending}
      onClick={() => {
        const fd = new FormData();
        fd.set("learnerId", learnerId);
        startTransition(async () => {
          const res = await toggleAralLearner(fd);
          if (res.ok) {
            toast.success(isAral ? "Removed from ARAL" : "Marked as ARAL learner");
            invalidateNavWarm();
          } else toast.error(res.error);
        });
      }}
    >
      <Sparkles className="h-4 w-4" />
      {pending ? (isAral ? "Updating…" : "Marking…") : isAral ? "ARAL ✓" : "Mark ARAL"}
    </Button>
  );
}
