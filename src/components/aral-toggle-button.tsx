"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { toggleAralLearner } from "@/lib/actions/learner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function runToggle(
  learnerId: string,
  isAral: boolean,
  startTransition: ReturnType<typeof useTransition>[1]
) {
  const fd = new FormData();
  fd.set("learnerId", learnerId);
  startTransition(async () => {
    const res = await toggleAralLearner(fd);
    if (res.ok) {
      toast.success(isAral ? "Removed from ARAL" : "Marked as ARAL learner");
    } else toast.error(res.error);
  });
}

export function AralToggleButton({ learnerId, isAral }: { learnerId: string; isAral: boolean }) {
  const [pending, startTransition] = useTransition();

  if (!isAral) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        aria-label="Mark as ARAL learner"
        onClick={() => runToggle(learnerId, false, startTransition)}
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        Mark ARAL
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          size="sm"
          variant="amber"
          disabled={pending}
          aria-label="Remove from ARAL program"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          ARAL ✓
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove ARAL status?</AlertDialogTitle>
          <AlertDialogDescription>
            This learner will no longer be marked as an ARAL learner. Their ARAL profile data is kept,
            but they will leave the ARAL list for this grade.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={pending}
            onClick={() => runToggle(learnerId, true, startTransition)}
          >
            {pending ? "Removing…" : "Remove from ARAL"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
