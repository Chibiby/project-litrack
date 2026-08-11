"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { enrollLearnersToAral } from "@/lib/actions/learner";
import { UserPlus } from "lucide-react";

export type EnrollCandidate = {
  id: string;
  fullName: string;
  sectionName: string | null;
};

type Props = {
  gradeId: string;
  candidates: EnrollCandidate[];
  disabled?: boolean;
};

export function EnrollToAralDialog({ gradeId, candidates, disabled }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter(
      (c) =>
        c.fullName.toLowerCase().includes(needle) ||
        (c.sectionName?.toLowerCase().includes(needle) ?? false)
    );
  }, [candidates, q]);

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAllVisible(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of filtered) {
        if (checked) next.add(c.id);
        else next.delete(c.id);
      }
      return next;
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      setQ("");
      setSelected(new Set());
    }
  }

  function handleEnroll() {
    const learnerIds = [...selected];
    if (learnerIds.length === 0) {
      toast.error("Select at least one learner");
      return;
    }
    startTransition(async () => {
      const toastId = toast.loading("Enrolling learners to ARAL…");
      const res = await enrollLearnersToAral({ gradeId, learnerIds });
      if (res.ok) {
        const n = res.data?.enrolled ?? 0;
        toast.success(
          n === 0 ? "Selected learners are already in ARAL" : `Enrolled ${n} learner${n === 1 ? "" : "s"}`,
          { id: toastId }
        );
        handleOpenChange(false);
        router.refresh();
      } else {
        toast.error(res.error, { id: toastId });
      }
    });
  }

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((c) => selected.has(c.id));

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button type="button" disabled={disabled || candidates.length === 0}>
          <UserPlus className="h-4 w-4" />
          Enroll to ARAL
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Enroll to ARAL</SheetTitle>
          <SheetDescription>
            Select already-enrolled grade learners who are not yet in ARAL.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <Input
            placeholder="Search by name or section…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search learners"
          />
          {filtered.length > 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox
                id="enroll-aral-select-all"
                checked={allVisibleSelected}
                onCheckedChange={(v) => toggleAllVisible(v === true)}
              />
              <Label
                htmlFor="enroll-aral-select-all"
                className="cursor-pointer font-normal text-muted-foreground"
              >
                Select all visible ({filtered.length})
              </Label>
            </div>
          ) : null}
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto rounded-md border">
          {candidates.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Every active learner in this grade is already enrolled in ARAL.
            </p>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No matches.</p>
          ) : (
            <ul className="divide-y">
              {filtered.map((c) => {
                const checkboxId = `enroll-aral-${c.id}`;
                return (
                  <li key={c.id}>
                    <div className="flex items-start gap-3 px-3 py-2.5 hover:bg-muted/40">
                      <Checkbox
                        id={checkboxId}
                        checked={selected.has(c.id)}
                        onCheckedChange={(v) => toggle(c.id, v === true)}
                        className="mt-0.5"
                      />
                      <Label
                        htmlFor={checkboxId}
                        className="min-w-0 cursor-pointer font-normal"
                      >
                        <span className="block text-sm font-medium text-foreground">
                          {c.fullName}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {c.sectionName ?? "No section"}
                        </span>
                      </Label>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <SheetFooter className="mt-4 gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleEnroll}
            disabled={pending || selected.size === 0}
          >
            {pending
              ? "Enrolling…"
              : `Enroll${selected.size > 0 ? ` (${selected.size})` : ""}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
