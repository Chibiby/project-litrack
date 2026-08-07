"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => {
        const fd = new FormData();
        fd.set("id", learnerId);
        startTransition(async () => {
          const res = archived
            ? await restoreLearner(fd)
            : await archiveLearner(fd);
          if (res.ok) {
            toast.success(archived ? "Learner restored" : "Learner archived");
            invalidateNavWarm();
          } else {
            toast.error(res.error);
          }
        });
      }}
    >
      {archived ? (
        <>
          <ArchiveRestore className="h-4 w-4" />
          {pending ? "Restoring…" : "Restore"}
        </>
      ) : (
        <>
          <Archive className="h-4 w-4" />
          {pending ? "Archiving…" : "Archive"}
        </>
      )}
    </Button>
  );
}
