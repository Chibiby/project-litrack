"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSchoolYear, setActiveSchoolYear } from "@/lib/actions/school-year";

export function CreateSchoolYearForm() {
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      action={(fd) =>
        startTransition(async () => {
          const res = await createSchoolYear(fd);
          if (!res.ok) toast.error(res.error);
          else toast.success("School year created");
        })
      }
    >
      <div className="space-y-2">
        <Label htmlFor="label">Label</Label>
        <Input id="label" name="label" placeholder="2025-2026" required disabled={pending} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="startDate">Start date</Label>
          <Input id="startDate" name="startDate" type="date" required disabled={pending} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endDate">End date</Label>
          <Input id="endDate" name="endDate" type="date" required disabled={pending} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="setActive" value="true" className="rounded border" />
        Set as active school year
      </label>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Create school year"}
      </Button>
    </form>
  );
}

export function SetActiveYearButton({ schoolYearId, disabled }: { schoolYearId: string; disabled?: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={disabled || pending}
      onClick={() => {
        const fd = new FormData();
        fd.set("schoolYearId", schoolYearId);
        startTransition(async () => {
          const res = await setActiveSchoolYear(fd);
          if (!res.ok) toast.error(res.error);
          else toast.success("Active school year updated");
        });
      }}
    >
      {pending ? "…" : "Set active"}
    </Button>
  );
}
