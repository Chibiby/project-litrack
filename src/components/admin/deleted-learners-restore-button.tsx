"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { callAction } from "@/lib/ui/call-action";
import { ToastedError, toastFailure } from "@/lib/ui/toast-failure";
import { restoreDeletedLearner } from "@/lib/actions/deleted-learners";

export function DeletedLearnerRestoreButton({
  id,
  name,
  schoolName,
  onRestored,
}: {
  id: string;
  name: string;
  schoolName: string;
  /** Called only after the server has confirmed the restore. */
  onRestored: (id: string) => void;
}) {
  const router = useRouter();

  const restore = async () => {
    const fd = new FormData();
    fd.set("id", id);
    const res = await callAction(() => restoreDeletedLearner(fd));
    if (!res.ok) {
      toastFailure(res);
      throw new ToastedError(res.error);
    }
    toast.success("Learner restored");
    onRestored(id);
    router.refresh();
  };

  return (
    <ConfirmAction
      title={`Restore ${name}?`}
      description={`They return to ${schoolName}'s active learner list and their teacher's roster.`}
      confirmLabel="Yes, restore"
      cancelLabel="No"
      variant="default"
      trigger={
        <Button type="button" variant="outline" size="sm" className="lg:h-9" aria-label={`Restore ${name}`}>
          <RotateCcw className="h-4 w-4" aria-hidden />
          Restore
        </Button>
      }
      onConfirm={restore}
    />
  );
}
