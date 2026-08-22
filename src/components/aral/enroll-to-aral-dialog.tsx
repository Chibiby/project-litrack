"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { EmploymentTypeChip } from "@/components/teachers/employment-type-chip";
import { enrollLearnersToAral } from "@/lib/actions/learner";
import { UserPlus } from "lucide-react";

export type EnrollCandidate = {
  id: string;
  fullName: string;
  sectionName: string | null;
};

/**
 * Structurally the `AralTutorOption` that `listAralTutors` returns, declared here
 * rather than imported: that module is `server-only`, and the shape travels in
 * this direction anyway — the server page fills a contract the picker states.
 */
export type EnrollTutorOption = {
  id: string;
  name: string;
  /** "Grade 3 · Sampaguita", or null for a teacher who advises nothing. */
  advisoryLabel: string | null;
  employmentType: "DEPED_PLANTILLA" | "NON_DEPED" | null;
};

type Props = {
  gradeId: string;
  candidates: EnrollCandidate[];
  /**
   * Every teacher at the school who may hold the designation, this one included.
   * Whoever is enrolling appears as "Myself" instead of by name, so they are
   * filtered out of the by-name list rather than shown twice.
   */
  tutors: EnrollTutorOption[];
  selfId: string;
  disabled?: boolean;
};

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

export function EnrollToAralDialog({
  gradeId,
  candidates,
  tutors,
  selfId,
  disabled,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** "Myself" carries `selfId` as its value — see `handleEnroll` for why. */
  const [tutorId, setTutorId] = useState(selfId);
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

  const otherTutors = useMemo(
    () => tutors.filter((t) => t.id !== selfId),
    [tutors, selfId]
  );

  const assignedToSelf = tutorId === selfId;
  const chosenName = useMemo(
    () => tutors.find((t) => t.id === tutorId)?.name ?? null,
    [tutors, tutorId]
  );

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
      setTutorId(selfId);
    }
  }

  function handleEnroll() {
    const learnerIds = [...selected];
    if (learnerIds.length === 0) {
      toast.error("Select at least one learner");
      return;
    }
    // Keeping them yourself sends no tutor at all rather than your own id. The
    // schema documents omission as that default, and the wire then says what
    // happened — the teacher named nobody — instead of implying a choice.
    const aralTeacherId = assignedToSelf ? undefined : tutorId;
    const who = assignedToSelf ? null : chosenName;

    startTransition(async () => {
      const toastId = toast.loading("Enrolling learners to ARAL…");
      const res = await enrollLearnersToAral({
        gradeId,
        learnerIds,
        aralTeacherId,
      });
      if (res.ok) {
        const enrolled = res.data?.enrolled ?? 0;
        // Already in ARAL under somebody else, and moved across by this action.
        // Reporting only `enrolled` would say "already in ARAL" about learners
        // that just changed hands.
        const moved = res.data?.redesignated ?? 0;
        const target = who ?? "you";
        const message =
          enrolled > 0 && moved > 0
            ? `Enrolled ${enrolled} learner${plural(enrolled)} and reassigned ${moved} to ${target}`
            : enrolled > 0
              ? who
                ? `Enrolled ${enrolled} learner${plural(enrolled)} for ${who}`
                : `Enrolled ${enrolled} learner${plural(enrolled)}`
              : moved > 0
                ? `Reassigned ${moved} learner${plural(moved)} to ${target}`
                : who
                  ? `Selected learners are already with ${who}`
                  : "Selected learners are already in ARAL";
        toast.success(message, { id: toastId });
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
          <div className="space-y-1.5">
            <Label htmlFor="enroll-aral-tutor">ARAL tutor</Label>
            <Select
              value={tutorId}
              onValueChange={setTutorId}
              disabled={pending || otherTutors.length === 0}
            >
              <SelectTrigger id="enroll-aral-tutor">
                {/* The trigger takes its own plain label: the option rows carry a
                    second line and a chip, and Radix would otherwise mirror that
                    whole block into this one-line control. */}
                <SelectValue>
                  {assignedToSelf ? "Myself" : (chosenName ?? "Myself")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={selfId}>Myself</SelectItem>
                {otherTutors.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-1.5">
                        <span>{t.name}</span>
                        <EmploymentTypeChip employmentType={t.employmentType} />
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t.advisoryLabel ?? "ARAL only"}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {otherTutors.length === 0
                ? "You are the only teacher who can be designated right now."
                : "Whoever tracks their weekly ARAL progress. Any teacher can be designated — they are told who assigned them."}
            </p>
          </div>

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
            disabled={selected.size === 0}
            loading={pending}
            loadingText="Enrolling…"
          >
            {`Enroll${selected.size > 0 ? ` (${selected.size})` : ""}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
