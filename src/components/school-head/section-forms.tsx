"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSection, updateSection, deleteSection } from "@/lib/actions/section";

export function CreateSectionForm({
  grades,
}: {
  grades: { id: string; label: string }[];
}) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      action={(fd) =>
        startTransition(async () => {
          const res = await createSection(fd);
          if (!res.ok) toast.error(res.error);
          else toast.success("Section created");
        })
      }
    >
      <div className="space-y-2">
        <Label htmlFor="gradeLevelId">Grade level</Label>
        <select
          id="gradeLevelId"
          name="gradeLevelId"
          required
          disabled={pending}
          className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
        >
          <option value="">Select grade</option>
          {grades.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="name">Section name</Label>
        <Input id="name" name="name" placeholder="e.g. Mabini" required disabled={pending} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Add section"}
      </Button>
    </form>
  );
}

export function SectionRowActions({
  sectionId,
  name,
}: {
  sectionId: string;
  name: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="flex items-center gap-2"
        action={(fd) =>
          startTransition(async () => {
            const res = await updateSection(fd);
            if (!res.ok) toast.error(res.error);
            else toast.success("Section updated");
          })
        }
      >
        <input type="hidden" name="sectionId" value={sectionId} />
        <Input
          name="name"
          defaultValue={name}
          className="h-8 w-36"
          disabled={pending}
          aria-label="Section name"
        />
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          Save
        </Button>
      </form>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-destructive"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Soft-delete section "${name}"?`)) return;
          const fd = new FormData();
          fd.set("sectionId", sectionId);
          startTransition(async () => {
            const res = await deleteSection(fd);
            if (!res.ok) toast.error(res.error);
            else toast.success("Section removed");
          });
        }}
      >
        Delete
      </Button>
    </div>
  );
}
