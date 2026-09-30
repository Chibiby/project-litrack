"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createGradeLevel } from "@/lib/actions/school-head";
import { Plus } from "lucide-react";
import { runOptimistic } from "@/lib/ui/optimistic";
import { callAction } from "@/lib/ui/call-action";
import { ToastedError, toastFailure } from "@/lib/ui/toast-failure";
import { isActionFailure } from "@/lib/errors/client";

export function CreateGradeLevelButton({
  type,
  label,
  onCreate,
  pending: pendingProp,
}: {
  type: string;
  label: string;
  /** Parent-owned optimistic create (moves card into active set). */
  onCreate?: () => void | Promise<void>;
  pending?: boolean;
}) {
  const [localPending, startTransition] = useTransition();
  const pending = pendingProp ?? localPending;

  const runStandalone = () =>
    runOptimistic(startTransition, async () => {
      const fd = new FormData();
      fd.set("type", type);
      const res = await callAction(() => createGradeLevel(fd));
      if (isActionFailure(res)) {
        toastFailure(res);
        throw new ToastedError(res.error);
      }
      toast.success(`${label} created`);
    });

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="w-full"
      loading={pending}
      loadingText="Creating…"
      onClick={() => {
        const handle = onCreate ?? runStandalone;
        void Promise.resolve(handle()).catch(() => {
          /* toast already shown */
        });
      }}
    >
      <Plus className="h-4 w-4" />
      Create
    </Button>
  );
}
