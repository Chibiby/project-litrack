"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { setTeacherAdvisorySetting } from "@/lib/actions/teacher";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";
import { ADVISORY_MODE_LABELS } from "@/lib/constants/enum-labels";
import type { ActiveTeacherRow } from "@/components/teachers-active-table";

type DesignationKind = "Teacher" | "Master Teacher" | typeof ARAL_VOLUNTEER_DESIGNATION | "__OTHER__";
type AdvisoryMode = "DEFAULT" | "FLOATING" | "MULTI_GRADE";

const DESIGNATION_KIND_OPTIONS: { value: DesignationKind; label: string }[] = [
  { value: "Teacher", label: "Teacher" },
  { value: "Master Teacher", label: "Master Teacher" },
  { value: ARAL_VOLUNTEER_DESIGNATION, label: ARAL_VOLUNTEER_DESIGNATION },
  { value: "__OTHER__", label: "Others" },
];

/**
 * `row.designation` back into a select value and a free-text field. A value
 * that is none of the three named literals is a custom designation — e.g.
 * "ARAL Coordinator" — and prefills Others with that text rather than
 * silently dropping it.
 */
function resolveDesignationKind(designation: string | null): {
  kind: DesignationKind;
  other: string;
} {
  if (designation === "Teacher" || designation === "Master Teacher") {
    return { kind: designation, other: "" };
  }
  if (designation === ARAL_VOLUNTEER_DESIGNATION) {
    return { kind: ARAL_VOLUNTEER_DESIGNATION, other: "" };
  }
  return { kind: "__OTHER__", other: designation ?? "" };
}

/**
 * The School Head's control for a teacher's designation and advisory setting,
 * the counterpart to the roster's own per-section picker: that one adds and
 * removes individual sections, this one changes the rule that caps how many
 * they may hold at all.
 *
 * Two-step on purpose. Lowering the cap below what a teacher currently holds
 * would silently orphan a section's roster if saved outright, so the first
 * submit never sends `confirmRelease` — only once the server names exactly
 * which sections would be freed, in the `confirm_release` branch below, does
 * a second submit carry it.
 */
export function TeacherRoleDialog({
  row,
  onSaved,
}: {
  row: ActiveTeacherRow;
  onSaved: () => void;
}) {
  const router = useRouter();
  const initial = resolveDesignationKind(row.designation);

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [designationKind, setDesignationKind] = useState<DesignationKind>(initial.kind);
  const [designationOther, setDesignationOther] = useState(initial.other);
  const [advisoryMode, setAdvisoryMode] = useState<AdvisoryMode>(row.advisoryMode ?? "DEFAULT");
  const [releases, setReleases] = useState<{ id: string; label: string }[] | null>(null);

  const resetFromRow = () => {
    const resolved = resolveDesignationKind(row.designation);
    setDesignationKind(resolved.kind);
    setDesignationOther(resolved.other);
    setAdvisoryMode(row.advisoryMode ?? "DEFAULT");
    setReleases(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (pending) return;
    if (next) resetFromRow();
    else setReleases(null);
    setOpen(next);
  };

  async function submit(confirmRelease: boolean) {
    setPending(true);
    try {
      const fd = new FormData();
      fd.set("teacherId", row.id);
      fd.set("designationKind", designationKind);
      if (designationKind === "__OTHER__") {
        fd.set("designationOther", designationOther.trim());
      }
      // A volunteer advises nothing whatever the radios last said, so a stale
      // MULTI_GRADE must not be stored against them and resurface later.
      fd.set(
        "advisoryMode",
        designationKind === ARAL_VOLUNTEER_DESIGNATION ? "DEFAULT" : advisoryMode
      );
      if (confirmRelease) fd.set("confirmRelease", "true");

      const res = await setTeacherAdvisorySetting(fd);
      if (!res.ok) {
        if ("releases" in res) {
          setReleases(res.releases);
          return;
        }
        toast.error(res.error);
        return;
      }
      toast.success(`Saved ${row.fullName}'s role`);
      setOpen(false);
      setReleases(null);
      onSaved();
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const isVolunteer = designationKind === ARAL_VOLUNTEER_DESIGNATION;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost">
          Edit role
        </Button>
      </DialogTrigger>
      <DialogContent>
        {releases ? (
          <>
            <DialogHeader>
              <DialogTitle>This unassigns:</DialogTitle>
            </DialogHeader>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {releases.map((r) => (
                <li key={r.id}>{r.label}</li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">
              Their learners stay in the section and will need a new adviser.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => setReleases(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                loading={pending}
                loadingText="Saving…"
                onClick={() => submit(true)}
              >
                Unassign and save
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (designationKind === "__OTHER__" && !designationOther.trim()) {
                toast.error("Enter the designation");
                return;
              }
              void submit(false);
            }}
          >
            <DialogHeader>
              <DialogTitle>Edit {row.fullName}&apos;s role</DialogTitle>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor={`role-designation-${row.id}`}>Designation</Label>
              {/* Native `<select>`, matching the roster's own advisory picker —
                  a Radix popper inside a dialog inside jsdom is the combination
                  that crashes the test runner (see AdvisoryCell for the same
                  reasoning applied to sections). */}
              <select
                id={`role-designation-${row.id}`}
                value={designationKind}
                disabled={pending}
                onChange={(e) => setDesignationKind(e.target.value as DesignationKind)}
                className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
              >
                {DESIGNATION_KIND_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {designationKind === "__OTHER__" ? (
                <div className="space-y-1">
                  <Label htmlFor={`role-designation-other-${row.id}`} className="sr-only">
                    Designation
                  </Label>
                  <Input
                    id={`role-designation-other-${row.id}`}
                    value={designationOther}
                    onChange={(e) => setDesignationOther(e.target.value)}
                    maxLength={100}
                    placeholder="Enter the designation"
                    disabled={pending}
                  />
                </div>
              ) : null}
            </div>

            {!isVolunteer ? (
              <div className="space-y-2">
                <Label>Advisory setting</Label>
                <RadioGroup
                  value={advisoryMode}
                  onValueChange={(v) => setAdvisoryMode(v as AdvisoryMode)}
                >
                  {(Object.keys(ADVISORY_MODE_LABELS) as AdvisoryMode[]).map((mode) => (
                    <div key={mode} className="flex items-center gap-2">
                      <RadioGroupItem
                        value={mode}
                        id={`role-advisory-${row.id}-${mode}`}
                        disabled={pending}
                      />
                      <Label htmlFor={`role-advisory-${row.id}-${mode}`} className="font-normal">
                        {ADVISORY_MODE_LABELS[mode]}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              </div>
            ) : null}

            <DialogFooter>
              <Button type="submit" loading={pending} loadingText="Saving…">
                Save
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
