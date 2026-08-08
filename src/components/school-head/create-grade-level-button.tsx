"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createGradeLevel } from "@/lib/actions/school-head";
import { Plus } from "lucide-react";

export function CreateGradeLevelButton({
  type,
  label,
}: {
  type: string;
  label: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="w-full"
      disabled={pending}
      onClick={() => {
        const fd = new FormData();
        fd.set("type", type);
        startTransition(async () => {
          try {
            await createGradeLevel(fd);
            toast.success(`${label} created`);
          } catch (err) {
            toast.error(
              err instanceof Error ? err.message : "Could not create grade level"
            );
          }
        });
      }}
    >
      <Plus className="h-4 w-4" />
      {pending ? "Creating…" : "Create"}
    </Button>
  );
}
