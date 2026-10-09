"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { GraduationCap } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { invalidateNavWarm } from "@/components/nav-prefetcher";
import { transferLearner } from "@/lib/actions/enrollment";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";
import {
  GRADE_FLOATING,
  SECTION_CLEAR,
  TRANSFER_REASON_MAX,
  TRANSFER_REASON_MIN,
} from "@/lib/validators/enrollment.schema";

/** One tap fills the reason box; the head can still edit or add detail. */
const COMMON_REASONS = [
  "Wrong grade level was encoded",
  "Learner was promoted",
  "Learner was retained",
  "Requested by parent or guardian",
] as const;

/** What the School Head Learners page loads for Change grade (never for a Super Admin view). */
export type ChangeGradeOptions = {
  /** Live grades, FLOATING excluded: Floating is offered as its own choice. */
  grades: { id: string; label: string }[];
  sections: { id: string; name: string; gradeLevelId: string }[];
  /** Active teachers with every live section they advise. */
  teachers: { id: string; fullName: string; advisories: { gradeLevelId: string; sectionName: string }[] }[];
  hasActiveYear: boolean;
};

export type ChangeGradeLearner = {
  id: string;
  name: string;
  gradeLevelId: string;
  gradeLabel: string;
  floating: boolean;
};

const SELECT_CLASS = "flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm";

/**
 * Moves one learner to another grade (or to Floating, or out of it), choosing
 * the section and the adviser. Same-grade moves belong to Transfer, so the
 * learner's own grade is not offered unless they are Floating.
 */
export function ChangeGradeDialog({
  learner,
  options,
  onClose,
}: {
  learner: ChangeGradeLearner | null;
  options: ChangeGradeOptions;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [gradeId, setGradeId] = useState("");
  const [sectionId, setSectionId] = useState(SECTION_CLEAR);
  const [teacherId, setTeacherId] = useState("");
  const [reason, setReason] = useState("");
  // The move rewrites the learner's placement in every report, so it is asked
  // twice: once with the form, once on a review of exactly what will change.
  const [confirming, setConfirming] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const trimmedReason = reason.trim();

  const [prevLearner, setPrevLearner] = useState(learner);
  if (learner !== prevLearner) {
    setPrevLearner(learner);
    setGradeId("");
    setSectionId(SECTION_CLEAR);
    setTeacherId("");
    setReason("");
    setConfirming(false);
    setErrors({});
  }

  const toFloating = gradeId === GRADE_FLOATING;
  const grades = options.grades.filter((g) => learner?.floating || g.id !== learner?.gradeLevelId);
  const sections = options.sections.filter((s) => s.gradeLevelId === gradeId);
  const teachers = options.teachers.filter((t) => t.advisories.some((a) => a.gradeLevelId === gradeId));
  const grade = grades.find((g) => g.id === gradeId);
  const section = sections.find((s) => s.id === sectionId);
  const teacher = teachers.find((t) => t.id === teacherId);
  const placed = toFloating || (grade !== undefined && teacher !== undefined);
  const ready = placed && trimmedReason.length >= TRANSFER_REASON_MIN;

  const close = () => {
    if (!pending) onClose();
  };

  const review = () => {
    if (!learner || !placed) return;
    if (trimmedReason.length < TRANSFER_REASON_MIN) {
      setErrors({ reason: `Give a reason for this change (at least ${TRANSFER_REASON_MIN} characters).` });
      document.getElementById("change-grade-reason")?.focus();
      return;
    }
    setErrors({});
    setConfirming(true);
  };

  const submit = () => {
    if (!learner || !ready) return;
    setErrors({});
    startTransition(async () => {
      const fd = new FormData();
      fd.set("learnerId", learner.id);
      fd.set("targetGradeLevelId", gradeId);
      // Floating carries no section and no teacher; the action refuses them.
      fd.set("targetSectionId", toFloating ? SECTION_CLEAR : sectionId || SECTION_CLEAR);
      fd.set("targetTeacherId", toFloating ? "" : teacherId);
      fd.set("reason", trimmedReason);
      const res = await callAction(() => transferLearner(fd));
      if (!res.ok) {
        toastFailure(res);
        if ("fieldErrors" in res && res.fieldErrors) setErrors(res.fieldErrors);
        // Back to the form so the field the server refused is on screen.
        setConfirming(false);
        return;
      }
      toast.success(
        toFloating ? `${learner.name} moved to Floating` : `${learner.name} moved to ${grade?.label ?? "the new grade"}`
      );
      onClose();
      invalidateNavWarm();
      router.refresh();
    });
  };

  const summary = !learner
    ? null
    : toFloating
      ? `Moves ${learner.name} from ${learner.gradeLabel} to Floating — no grade, no section, no adviser. Their ARAL designation is kept.`
      : grade && teacher
        ? `Moves ${learner.name} from ${learner.gradeLabel} to ${grade.label}${
            section ? `, section ${section.name}` : ", no section"
          }, under ${teacher.fullName}.`
        : null;

  return (
    <Dialog open={learner !== null} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-4 overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <GraduationCap className="h-5 w-5" aria-hidden />
          </span>
          <DialogTitle className="mt-3">Change grade{learner ? ` for ${learner.name}` : ""}</DialogTitle>
          <DialogDescription>
            Move the learner to another grade, with a section and an adviser, or to Floating. To move them
            within {learner?.gradeLabel ?? "their grade"}, use Transfer instead.
          </DialogDescription>
        </DialogHeader>

        {confirming && summary ? (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
            <Callout title={toFloating ? "Confirm move to Floating" : "Confirm grade change"}>
              This changes the learner&apos;s grade in their records and in every report. Check the details below.
            </Callout>
            <dl className="space-y-3 rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Change</dt>
                <dd className="text-foreground">{summary}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Reason</dt>
                <dd className="whitespace-pre-wrap break-words text-foreground">{trimmedReason}</dd>
              </div>
            </dl>
          </div>
        ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {!options.hasActiveYear ? (
            <Callout title="No active school year">
              The learner will move now, but the change will not be added to their enrolment history until a
              school year is active.
            </Callout>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="change-grade-grade">New grade</Label>
            <select
              id="change-grade-grade"
              value={gradeId}
              onChange={(e) => {
                setGradeId(e.target.value);
                setSectionId(SECTION_CLEAR);
                setTeacherId("");
                setErrors({});
              }}
              disabled={pending}
              aria-invalid={errors.targetGradeLevelId ? true : undefined}
              aria-describedby={errors.targetGradeLevelId ? "change-grade-grade-error" : undefined}
              className={SELECT_CLASS}
            >
              <option value="">Select grade</option>
              {grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
              {learner?.floating ? null : <option value={GRADE_FLOATING}>Floating — no grade or section</option>}
            </select>
            {errors.targetGradeLevelId ? (
              <p id="change-grade-grade-error" className="text-sm text-destructive">
                {errors.targetGradeLevelId}
              </p>
            ) : null}
            {toFloating ? (
              <p className="text-xs text-muted-foreground">
                Floating holds learners who are not yet placed in a grade or section. They keep their records and
                their ARAL teacher, and appear under the Floating filter in learner lists.
              </p>
            ) : null}
          </div>

          {toFloating ? null : (
            <>
              <div className="space-y-2">
                <Label htmlFor="change-grade-section">Section (optional)</Label>
                <select
                  id="change-grade-section"
                  value={sectionId}
                  onChange={(e) => setSectionId(e.target.value)}
                  disabled={pending || !gradeId}
                  className={SELECT_CLASS}
                >
                  <option value={SECTION_CLEAR}>No section</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="change-grade-teacher">Adviser</Label>
                <select
                  id="change-grade-teacher"
                  value={teacherId}
                  onChange={(e) => setTeacherId(e.target.value)}
                  disabled={pending || !gradeId}
                  className={SELECT_CLASS}
                >
                  <option value="">Select adviser</option>
                  {teachers.map((t) => {
                    const held = t.advisories.filter((a) => a.gradeLevelId === gradeId).map((a) => a.sectionName);
                    return (
                      <option key={t.id} value={t.id}>
                        {held.length > 0 ? `${t.fullName} (${held.join(", ")})` : t.fullName}
                      </option>
                    );
                  })}
                </select>
                {gradeId && teachers.length === 0 ? (
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    No teacher advises a section in this grade yet. Assign an advisory section on the Teachers page
                    first.
                  </p>
                ) : null}
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="change-grade-reason">Reason for this change</Label>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Common reasons">
              {COMMON_REASONS.map((r) => (
                <Button
                  key={r}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    setReason(r);
                    setErrors((prev) => ({ ...prev, reason: "" }));
                  }}
                  aria-pressed={trimmedReason === r}
                  className="rounded-full text-xs aria-pressed:border-primary aria-pressed:bg-primary/10"
                >
                  {r}
                </Button>
              ))}
            </div>
            <Textarea
              id="change-grade-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                if (errors.reason) setErrors((prev) => ({ ...prev, reason: "" }));
              }}
              maxLength={TRANSFER_REASON_MAX}
              disabled={pending}
              placeholder="Why is this learner's grade being changed?"
              aria-invalid={errors.reason ? true : undefined}
              aria-describedby="change-grade-reason-hint"
            />
            <p
              id="change-grade-reason-hint"
              className={errors.reason ? "text-sm text-destructive" : "text-xs text-muted-foreground"}
            >
              {errors.reason ||
                `Required. Saved with the learner's enrolment record. ${reason.length}/${TRANSFER_REASON_MAX}`}
            </p>
          </div>

          {summary ? (
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm text-foreground" aria-live="polite">
              {summary}
            </p>
          ) : null}
        </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {confirming ? (
            <>
              <Button type="button" variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
                Back
              </Button>
              <Button type="button" onClick={submit} loading={pending} loadingText="Moving…" disabled={!ready}>
                {toFloating ? "Yes, move to Floating" : "Yes, change grade"}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button type="button" onClick={review} disabled={!placed || pending}>
                Review change
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
