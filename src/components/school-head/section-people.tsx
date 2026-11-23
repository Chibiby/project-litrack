"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft, ChevronDown, GraduationCap, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { TransferLearnersDialog } from "@/components/learners/transfer-learners-dialog";
import type { TransferCandidate, TransferDestination } from "@/components/learners/transfer-eligibility";
import { invalidateNavWarm } from "@/components/nav-prefetcher";
import { setTeacherAdvisorySection } from "@/lib/actions/teacher";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";
import { MAX_ADVISORY_SECTIONS } from "@/lib/teachers/advisory-limits";
import type { SectionPeople, SectionTeacherRole } from "@/lib/school-head/section-people";

const ROLE_LABEL: Record<SectionTeacherRole, string> = {
  ADVISER: "Adviser",
  TEACHER: "Teacher",
  ARAL: "ARAL teacher",
};

const NO_ADVISER = "__none__";

/** A teacher the School Head can make a section's adviser. */
export type AdviserOption = {
  id: string;
  name: string;
  advisoryCount: number;
  /** How many sections this teacher may advise (`advisoryCapFor`), at least 1. */
  cap: number;
};

/** What a grade card passes down so each section can be managed in place. */
export type SectionManageContext = {
  gradeLevelId: string;
  gradeLabel: string;
  gradeType: string;
  adviserOptions: AdviserOption[];
  readOnly: boolean;
};

/**
 * The expandable part of a section row: who teaches in it and who is enrolled,
 * and the two jobs a School Head does there — choosing the adviser and moving
 * learners to another section of the same grade. Closed by default so a grade
 * with nine sections stays one screen tall.
 */
export function SectionPeoplePanel({
  sectionId,
  name,
  people,
  manage,
  destinations,
}: {
  sectionId: string;
  name: string;
  people: SectionPeople;
  manage?: SectionManageContext;
  /** Other live sections of the same grade, for Move learners. */
  destinations: TransferDestination[];
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { teachers, learners } = people;
  const aralCount = learners.filter((l) => l.isAral).length;
  const canManage = Boolean(manage && !manage.readOnly);

  return (
    <div className="w-full basis-full">
      <Button
        type="button"
        variant="ghost"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${open ? "Hide" : "Show"} teachers and learners of ${manage ? `${manage.gradeLabel} ` : ""}section ${name}`}
        onClick={() => setOpen((o) => !o)}
        className="h-auto w-full justify-start whitespace-normal px-1 py-1.5 text-left text-xs font-normal text-muted-foreground lg:h-auto"
      >
        <ChevronDown
          aria-hidden
          className={cn("size-4 shrink-0 transition-transform duration-base", open && "rotate-180")}
        />
        <span>
          {people.adviser ? `Adviser: ${people.adviser.name}` : "No adviser"} · {teachers.length}{" "}
          {teachers.length === 1 ? "teacher" : "teachers"} · {learners.length}{" "}
          {learners.length === 1 ? "learner" : "learners"}
          {aralCount > 0 ? ` (${aralCount} in ARAL)` : ""}
        </span>
      </Button>

      <div id={panelId} hidden={!open} className="mt-2 space-y-4">
        {canManage && manage ? (
          <AdviserControl sectionId={sectionId} name={name} people={people} options={manage.adviserOptions} />
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <TeacherList name={name} people={people} />
          <LearnerList
            sectionId={sectionId}
            name={name}
            people={people}
            manage={canManage ? manage : undefined}
            destinations={destinations}
          />
        </div>
      </div>
    </div>
  );
}

function AdviserControl({
  sectionId,
  name,
  people,
  options,
}: {
  sectionId: string;
  name: string;
  people: SectionPeople;
  options: AdviserOption[];
}) {
  const router = useRouter();
  const id = useId();
  const current = people.adviser?.id ?? NO_ADVISER;
  const [value, setValue] = useState(current);
  const [pending, startTransition] = useTransition();

  // Keep the picker on the saved adviser after a refresh brings a new one.
  const [prevCurrent, setPrevCurrent] = useState(current);
  if (prevCurrent !== current) {
    setPrevCurrent(current);
    setValue(current);
  }

  const selectOptions: SearchableOption[] = [
    { value: NO_ADVISER, label: "No adviser" },
    // A sitting adviser who is no longer a selectable teacher stays visible.
    ...(people.adviser && !options.some((o) => o.id === people.adviser!.id)
      ? [{ value: people.adviser.id, label: people.adviser.name, hint: "Inactive" }]
      : []),
    ...options.map((o) => ({
      value: o.id,
      label: o.name,
      hint:
        o.advisoryCount >= o.cap && o.id !== people.adviser?.id
          ? o.cap === MAX_ADVISORY_SECTIONS
            ? `Full: already advises ${o.cap} sections`
            : "Full: already advises a section. Make them Multi-advisory in Teachers to add more."
          : o.advisoryCount > 0
            ? `Advises ${o.advisoryCount} of ${o.cap}`
            : "No advisory yet",
    })),
  ];

  const run = (teacherId: string, op: "add" | "remove") => {
    const fd = new FormData();
    fd.set("teacherId", teacherId);
    fd.set("sectionId", sectionId);
    fd.set("op", op);
    return callAction(() => setTeacherAdvisorySection(fd));
  };

  const save = () =>
    startTransition(async () => {
      // A section holds one adviser and the action refuses an occupied one,
      // so a change is two steps: release the sitting adviser, then assign.
      if (people.adviser) {
        const res = await run(people.adviser.id, "remove");
        if (!res.ok) {
          toastFailure(res);
          return;
        }
      }
      if (value !== NO_ADVISER) {
        const res = await run(value, "add");
        if (!res.ok) {
          toastFailure(res);
          router.refresh();
          return;
        }
      }
      toast.success(
        value === NO_ADVISER
          ? `Section ${name} has no adviser now`
          : `Adviser of ${name} saved`
      );
      invalidateNavWarm();
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-3 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1 space-y-1">
        <Label htmlFor={id} className="text-xs">
          Adviser of {name}
        </Label>
        <SearchableSelect
          id={id}
          options={selectOptions}
          value={value}
          onValueChange={setValue}
          placeholder="Choose a teacher"
          searchPlaceholder="Search teachers…"
          emptyMessage="No teacher by that name."
          disabled={pending}
          chevron="down"
        />
      </div>
      <Button
        type="button"
        size="sm"
        disabled={value === current}
        loading={pending}
        loadingText="Saving…"
        onClick={save}
      >
        Save adviser
      </Button>
    </div>
  );
}

function TeacherList({ name, people }: { name: string; people: SectionPeople }) {
  return (
    <section aria-label={`Teachers of ${name}`} className="space-y-1.5">
      <h4 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Users aria-hidden className="size-3.5" /> Teachers
      </h4>
      {people.teachers.length === 0 ? (
        <p className="text-xs text-muted-foreground">No adviser or teacher assigned yet.</p>
      ) : (
        <ul className="space-y-1">
          {people.teachers.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-1.5 text-sm">
              <span className={cn("min-w-0 break-words", t.inactive && "text-muted-foreground line-through")}>
                {t.name}
              </span>
              {t.roles.map((r) => (
                <Badge
                  key={r}
                  variant={r === "ARAL" ? "violet" : r === "ADVISER" ? "default" : "outline"}
                  className="px-1.5 py-0 text-[10px]"
                >
                  {ROLE_LABEL[r]}
                </Badge>
              ))}
              {t.inactive ? <span className="text-[11px] text-muted-foreground">Inactive</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LearnerList({
  sectionId,
  name,
  people,
  manage,
  destinations,
}: {
  sectionId: string;
  name: string;
  people: SectionPeople;
  manage?: SectionManageContext;
  destinations: TransferDestination[];
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [moving, setMoving] = useState(false);
  const { learners } = people;
  // Ids that left the section after a refresh drop out of the selection.
  const picked = learners.filter((l) => selected.has(l.id));
  const allPicked = learners.length > 0 && picked.length === learners.length;

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const candidates: TransferCandidate[] = manage
    ? picked.map((l) => ({
        id: l.id,
        name: l.name,
        gradeLevelId: manage.gradeLevelId,
        gradeLabel: manage.gradeLabel,
        gradeType: manage.gradeType,
        sectionId,
        archived: false,
        pendingRequest: l.pendingRequest,
      }))
    : [];

  return (
    <section aria-label={`Learners of ${name}`} className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <GraduationCap aria-hidden className="size-3.5" /> Learners
        </h4>
        {manage && learners.length > 0 ? (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox
                checked={allPicked}
                onCheckedChange={(v) => setSelected(v === true ? new Set(learners.map((l) => l.id)) : new Set())}
                aria-label={`Select all learners of ${name}`}
              />
              All
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={picked.length === 0 || destinations.length === 0}
              onClick={() => setMoving(true)}
              title={destinations.length === 0 ? "This grade has no other section to move learners to." : undefined}
            >
              <ArrowRightLeft aria-hidden className="size-4" />
              Move{picked.length > 0 ? ` (${picked.length})` : ""}
            </Button>
          </div>
        ) : null}
      </div>
      {learners.length === 0 ? (
        <p className="text-xs text-muted-foreground">No learners in this section.</p>
      ) : (
        <ol className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
          {learners.map((l, i) => (
            <li key={l.id} className="flex items-center gap-2 text-sm">
              {manage ? (
                <Checkbox
                  checked={selected.has(l.id)}
                  onCheckedChange={(v) => toggle(l.id, v === true)}
                  aria-label={`Select ${l.name}`}
                />
              ) : null}
              <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
              <span className="min-w-0 truncate" title={l.name}>
                {l.name}
              </span>
              {l.isAral ? (
                <Badge variant="violet" className="px-1.5 py-0 text-[10px]">
                  ARAL
                </Badge>
              ) : null}
              {l.pendingRequest ? (
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                  Transfer requested
                </Badge>
              ) : null}
            </li>
          ))}
        </ol>
      )}
      {manage ? (
        <TransferLearnersDialog
          mode="transfer"
          open={moving}
          candidates={candidates}
          destinations={destinations}
          onClose={() => setMoving(false)}
          onDone={() => setSelected(new Set())}
        />
      ) : null}
    </section>
  );
}
