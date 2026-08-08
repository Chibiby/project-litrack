"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { Archive, ArchiveRestore } from "lucide-react";
import { archiveLearner, restoreLearner } from "@/lib/actions/learner";
import { invalidateNavWarm } from "@/components/nav-prefetcher";

export function LearnerArchiveButton({
  learnerId,
  archived,
}: {
  learnerId: string;
  archived: boolean;
}) {
  const [pending, startTransition] = useTransition();

  if (archived) {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          const fd = new FormData();
          fd.set("id", learnerId);
          startTransition(async () => {
            const res = await restoreLearner(fd);
            if (res.ok) {
              toast.success("Learner restored");
              invalidateNavWarm();
            } else {
              toast.error(res.error);
            }
          });
        }}
      >
        <ArchiveRestore className="h-4 w-4" />
        {pending ? "Restoring…" : "Restore"}
      </Button>
    );
  }

  return (
    <ConfirmAction
      title="Archive learner?"
      description="They will be hidden from active lists and can be restored later."
      confirmLabel="Archive"
      variant="destructive"
      disabled={pending}
      trigger={
        <Button size="sm" variant="outline" disabled={pending}>
          <Archive className="h-4 w-4" />
          {pending ? "Archiving…" : "Archive"}
        </Button>
      }
      onConfirm={async () => {
        const fd = new FormData();
        fd.set("id", learnerId);
        const res = await archiveLearner(fd);
        if (res.ok) {
          toast.success("Learner archived");
          invalidateNavWarm();
        } else {
          toast.error(res.error);
          throw new Error(res.error);
        }
      }}
    />
  );
}
