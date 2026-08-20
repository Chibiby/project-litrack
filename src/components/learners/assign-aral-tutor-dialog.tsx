"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles, UserRoundCog } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmploymentTypeChip } from "@/components/teachers/employment-type-chip";
import { invalidateNavWarm } from "@/components/nav-prefetcher";
import { listAralTutorOptions } from "@/lib/actions/aral-tutors";
import { enrollRosterLearnersToAral } from "@/lib/actions/learner";

/**
 * The one place a teacher names an ARAL tutor from the roster.
 *
 * Enrolment and reassignment are the same decision — who tracks this learner's
 * weekly ARAL progress — so they are the same dialog rather than two that differ
 * only in a verb. `target.enrolling` picks the wording; the action behind it
 * assigns or moves as each learner requires.
 *
 * The tutor list is fetched when the dialog first opens, not shipped with the
 * page: the roster mounts one of these for every visit and most visits never
 * open it. Once fetched it is kept, so the second and later openings are instant.
 */

/**
 * Structurally the `AralTutorOption` that `listAralTutors` returns, declared here
 * rather than imported: that module is `server-only`, and the shape travels in
 * this direction anyway — the server fills a contract the picker states.
 */
type TutorOption = {
  id: string;
  name: string;
  /** "Grade 3 · Sampaguita", or null for a teacher who advises nothing. */
  advisoryLabel: string | null;
  employmentType: "DEPED_PLANTILLA" | "NON_DEPED" | null;
};

export type AssignAralTutorTarget = {
  /** Learners to act on. Must be non-empty. */
  learnerIds: string[];
  /** One learner's name when a single row opened this; null for a bulk pick. */
  learnerName: string | null;
  /**
   * Tutor to pre-select — the learner's current one, where the caller knows it.
   * Null falls back to "Myself", which is the right default for an enrolment.
   */
  currentTutorId: string | null;
  /**
   * False when every selected learner is already in ARAL, which makes this a
   * change of tutor rather than an enrolment. Wording only: the action decides
   * per learner what actually has to happen.
   */
  enrolling: boolean;
};

type Props = {
  /** The open dialog's subject; `null` keeps it closed. */
  target: AssignAralTutorTarget | null;
  onClose: () => void;
  /** Ran after a successful write — the roster clears its selection here. */
  onDone?: () => void;
};

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

export function AssignAralTutorDialog({ target, onClose, onDone }: Props) {
  const router = useRouter();
  const [tutors, setTutors] = useState<TutorOption[] | null>(null);
  const [selfId, setSelfId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** The teacher's pick. Null means "not chosen yet" — see `chosenId`. */
  const [tutorId, setTutorId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /** One fetch per mount, retried only when it failed. */
  const requested = useRef(false);

  const open = target !== null;

  const load = useCallback(() => {
    requested.current = true;
    setLoading(true);
    setLoadError(null);
    void listAralTutorOptions().then((res) => {
      if (res.ok && res.data) {
        setTutors(res.data.tutors);
        setSelfId(res.data.selfId);
      } else {
        // Clearing the flag is what lets Try again run; the effect below cannot
        // fire twice on its own, since neither of its deps changed.
        requested.current = false;
        setLoadError(res.ok ? "Could not load teachers." : res.error);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (open && !requested.current) load();
  }, [open, load]);

  // Each opening starts from its own learner's tutor, never the previous row's.
  useEffect(() => {
    setTutorId(target?.currentTutorId ?? null);
  }, [target]);

  /** Falls back to the caller once the list lands — "Myself" is the default. */
  const chosenId = tutorId ?? selfId;
  const assignedToSelf = chosenId !== null && chosenId === selfId;

  const otherTutors = useMemo(
    () => (tutors ?? []).filter((t) => t.id !== selfId),
    [tutors, selfId]
  );

  const chosenName = useMemo(
    () => (tutors ?? []).find((t) => t.id === chosenId)?.name ?? null,
    [tutors, chosenId]
  );

  const enrolling = target?.enrolling ?? true;
  const count = target?.learnerIds.length ?? 0;
  const subject =
    target?.learnerName ?? `${count} learner${plural(count)}`;

  function handleSubmit() {
    if (!target || !chosenId) return;
    // Keeping them yourself sends no tutor at all rather than your own id: the
    // schema documents omission as that default, so the wire says what happened
    // — the teacher named nobody — instead of implying a choice.
    const aralTeacherId = assignedToSelf ? undefined : chosenId;
    const who = assignedToSelf ? null : chosenName;

    startTransition(async () => {
      const toastId = toast.loading(
        enrolling ? "Enrolling in ARAL…" : "Changing ARAL tutor…"
      );
      const res = await enrollRosterLearnersToAral({
        learnerIds: target.learnerIds,
        aralTeacherId,
      });
      if (!res.ok) {
        toast.error(res.error, { id: toastId });
        return;
      }

      const enrolled = res.data?.enrolled ?? 0;
      // Learners already in ARAL under somebody else, moved across by this
      // write. Reporting only `enrolled` would say "already in ARAL" about
      // learners that just changed hands.
      const moved = res.data?.redesignated ?? 0;
      const target_ = who ?? "you";
      const message =
        enrolled > 0 && moved > 0
          ? `Enrolled ${enrolled} learner${plural(enrolled)} and moved ${moved} to ${target_}`
          : enrolled > 0
            ? who
              ? `Enrolled ${enrolled} learner${plural(enrolled)} for ${who}`
              : `Enrolled ${enrolled} learner${plural(enrolled)}`
            : moved > 0
              ? `Moved ${moved} learner${plural(moved)} to ${target_}`
              : who
                ? `Already with ${who} — nothing changed`
                : "Already yours — nothing changed";

      toast.success(message, { id: toastId });
      onClose();
      onDone?.();
      invalidateNavWarm();
      router.refresh();
    });
  }

  const title = enrolling
    ? `Enroll ${subject} in ARAL`
    : target?.learnerName
      ? `Change ${target.learnerName}'s ARAL tutor`
      : `Change ARAL tutor for ${subject}`;

  const description = enrolling
    ? "Pick who will tutor them, then confirm. They join the ARAL roster and appear in the weekly attendance and reading grids."
    : "Pick who takes over. The learner stays in ARAL — only the tutor changes.";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <span className="flex size-10 items-center justify-center rounded-xl bg-violet-soft text-violet-soft-foreground">
            {enrolling ? (
              <Sparkles className="h-5 w-5" aria-hidden />
            ) : (
              <UserRoundCog className="h-5 w-5" aria-hidden />
            )}
          </span>
          <DialogTitle className="mt-3">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="assign-aral-tutor">ARAL tutor</Label>

          {loadError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm text-destructive">{loadError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={load}
                disabled={loading}
              >
                {loading ? "Loading…" : "Try again"}
              </Button>
            </div>
          ) : chosenId === null ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <>
              <Select
                value={chosenId}
                onValueChange={setTutorId}
                disabled={pending || otherTutors.length === 0}
              >
                <SelectTrigger id="assign-aral-tutor">
                  {/* The trigger takes its own plain label: the option rows
                      carry a second line and a chip, and Radix would otherwise
                      mirror that whole block into this one-line control. */}
                  <SelectValue>
                    {assignedToSelf ? "Myself" : (chosenName ?? "Myself")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {selfId ? <SelectItem value={selfId}>Myself</SelectItem> : null}
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
                  : "Any teacher at your school can be designated — DepEd or volunteer, advisory class or not. They are told who assigned them."}
              </p>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={pending || chosenId === null || loadError !== null}
          >
            {pending
              ? enrolling
                ? "Enrolling…"
                : "Saving…"
              : enrolling
                ? `Enroll${count > 1 ? ` ${count}` : ""}`
                : "Save tutor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
