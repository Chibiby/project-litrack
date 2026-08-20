"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { ArrowLeftRight, Pencil, Sparkles, UserRound, UserRoundCog } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FormSectionsSkeleton } from "@/components/forms/form-skeleton";
import { ConfirmAction } from "@/components/confirm-action";
import {
  AssignAralTutorDialog,
  type AssignAralTutorTarget,
} from "@/components/learners/assign-aral-tutor-dialog";
import { invalidateNavWarm } from "@/components/nav-prefetcher";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { getLearnerProfile } from "@/lib/actions/learner-profile";
import { toggleAralLearner } from "@/lib/actions/learner";
import type { LearnerProfileData } from "@/lib/learners/profile";
import { runOptimistic, settleActionResult } from "@/lib/ui/optimistic";
import { AralPanel } from "./aral-panel";
import { AttendancePanel } from "./attendance-panel";
import { GradesPanel } from "./grades-panel";
import { ProfilePanel } from "./profile-panel";
import { ReadingPanel } from "./reading-panel";
import {
  ProfileTabs,
  panelId,
  tabId,
  type ProfileTabKey,
} from "./profile-tabs";

/*
 * DIRECTION CONTRACT — Student Profile dialog
 *
 * THESIS      The supplied comp is the spec: icon-tile header, five-tab
 *             underline strip, identity rail beside stacked information cards,
 *             actions pinned in a footer row.
 * OWN-WORLD   LITRACK's identity unchanged — white card panels on the muted
 *             field, blue primary, violet reserved for ARAL.
 * FORM        Reproduction of the comp. Where LITRACK has no column for a field
 *             the comp draws, the slot keeps its geometry and carries the
 *             nearest real fact; see the truth notes in profile-panel.tsx.
 *
 * The comp's single "Close" button is replaced, per the brief, by three actions
 * in one row: Transfer student, Enroll as ARAL, Edit. The ✕ in the header is
 * the only way this dialog closes without acting.
 *
 * Enroll as ARAL asks who will tutor the learner before it enrolls them, so it
 * opens the tutor picker instead of a bare confirmation. Removal is the one
 * direction with nothing to choose, and so the one that keeps a confirm.
 * Changing the tutor of a learner already in the program is that same question
 * asked again, and it stands in the footer beside Transfer student: both move a
 * learner from one person's care to another's, and a teacher hunting for either
 * looks at the row of actions rather than inside a tab.
 *
 * TWO MODES, ONE DIALOG
 *
 * Edit does not navigate. It turns this dialog into the edit form in place: the
 * tab strip and the action footer give way to the sectioned learner form, which
 * brings its own Cancel and Save changes, and saving re-reads the row and returns
 * to the tabs without the dialog ever closing. Editing a learner used to mean a
 * page load away from the roster and a page load back.
 *
 * Edit needs no second read. The form's only remaining facts about placement are
 * the grade type (for the reading-band labels) and the grade and section names it
 * shows read-only, and the profile row already carries all three — the section
 * list this dialog used to fetch on the first Edit press disappeared with the
 * section select, and with it the wait before the form could draw.
 */

/**
 * The edit form, loaded only when a teacher actually presses Edit — the same
 * chunk the Add learner dialog defers, and the roster mounts this dialog on every
 * page. `FormSectionsSkeleton` holds the geometry so the swap does not jump.
 */
const LearnerForm = dynamic(
  () => import("@/components/forms/learner-form").then((m) => m.LearnerForm),
  { ssr: false, loading: () => <FormSectionsSkeleton showBar={false} /> }
);

export type LearnerProfileModalProps = {
  /** Learner to show. `null` keeps the dialog closed. */
  learnerId: string | null;
  onClose: () => void;
  /**
   * Super Admin views a teacher's roster read-only; the three write actions are
   * suppressed rather than shown disabled, matching the roster's own treatment.
   */
  isSuperAdmin: boolean;
  /**
   * The opening row's ARAL flag. The roster already renders it, so passing it
   * lets the footer name its ARAL action correctly while the row is still
   * loading instead of showing "Enroll" and then flipping to "Remove".
   */
  initialIsAralLearner?: boolean;
  /**
   * Open straight into the edit form, for a host whose whole purpose is Edit —
   * the learner detail page's button. Cancel and a completed save then close the
   * dialog rather than falling back to tabs the host is already showing.
   */
  initialMode?: "view" | "edit";
};

export function LearnerProfileModal({
  learnerId,
  onClose,
  isSuperAdmin,
  initialIsAralLearner = false,
  initialMode = "view",
}: LearnerProfileModalProps) {
  const router = useRouter();
  const [tab, setTab] = useState<ProfileTabKey>("profile");
  const [learner, setLearner] = useState<LearnerProfileData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  /** `edit` swaps the tabs and the action footer for the learner form. */
  const [mode, setMode] = useState<"view" | "edit">(initialMode);
  /** Subject of the open ARAL tutor picker; `null` when it is closed. */
  const [aralTarget, setAralTarget] = useState<AssignAralTutorTarget | null>(
    null
  );

  const open = learnerId !== null;
  const editing = mode === "edit";
  /** Edit was the dialog's reason for opening, so there is no view to return to. */
  const editOnly = initialMode === "edit";

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    const res = await getLearnerProfile(id);
    if (res.ok) {
      setLearner(res.data);
    } else {
      setLearner(null);
      setError(res.error);
    }
    setLoading(false);
  }, []);

  // Reset to the first tab for each learner so the dialog never opens on the
  // tab left behind by the previous row — nor, since Edit is now in-place, on
  // the previous row's edit form.
  useEffect(() => {
    if (!learnerId) return;
    setTab("profile");
    setMode(initialMode);
    setLearner(null);
    void load(learnerId);
  }, [learnerId, initialMode, load]);

  const handleOpenChange = (next: boolean) => {
    if (!next) onClose();
  };

  const aralEnrolled = learner?.isAralLearner ?? initialIsAralLearner;
  const archived = Boolean(learner?.archivedAt);
  /** A failed read leaves nothing to act on; Super Admin reads only. */
  const showActions = !isSuperAdmin && error === null;

  /**
   * Removal only. Enrolling goes through the tutor picker — a learner needs
   * someone tracking their weekly progress before they join the program — which
   * leaves this direction the one with nothing to choose, and so the one a plain
   * confirmation still fits.
   */
  const handleRemoveFromAral = () => {
    if (!learner) return;
    return runOptimistic(startTransition, async () => {
      const fd = new FormData();
      fd.set("learnerId", learner.id);
      const res = await toggleAralLearner(fd);
      await settleActionResult(res, "Removed from ARAL");
      // The action clears the designation on the way out, so the local copy
      // drops it too rather than printing a tutor for a learner who has left.
      setLearner((prev) =>
        prev
          ? {
              ...prev,
              isAralLearner: false,
              aralEnrolledAt: null,
              aralTeacherId: null,
              aralTutorName: null,
            }
          : prev
      );
      invalidateNavWarm();
      router.refresh();
    });
  };

  /**
   * Opens the tutor picker for this learner, in whichever direction they are
   * in: an enrolment for a learner outside the program, a reassignment for one
   * already in it. The picker asks the same question either way, so the ARAL tab
   * and the footer share one entry point rather than each having its own.
   */
  const openAralPicker = () => {
    if (!learner) return;
    setAralTarget({
      learnerIds: [learner.id],
      learnerName: learner.fullName,
      currentTutorId: learner.aralTeacherId,
      enrolling: !aralEnrolled,
    });
  };

  // One definition for both footer states: worn bare while the row loads, then
  // wrapped in the confirm sheet once there is a learner to name inside it.
  const aralButton = (
    <Button
      type="button"
      variant="outline"
      disabled={learner === null || archived || pending}
      className="justify-center gap-2"
      // Enrolling names a tutor first, so the button opens the picker; removal
      // is confirmed by the wrapper below and needs no handler of its own.
      onClick={aralEnrolled ? undefined : openAralPicker}
    >
      <Sparkles className="h-4 w-4" aria-hidden />
      {aralEnrolled ? "Remove from ARAL" : "Enroll as ARAL"}
    </Button>
  );

  /**
   * Reassigning the tutor of a learner already in the program. It sits in the
   * footer beside Transfer student because the two are the same kind of act —
   * moving a learner from one person's care to another's — and a teacher looking
   * for it goes to the row of actions, not to a tab.
   *
   * Absent for a learner outside ARAL: Enroll as ARAL already asks the question,
   * so a second button asking it again would be the same control twice.
   */
  const transferTutorButton =
    learner && aralEnrolled ? (
      <Button
        type="button"
        variant="outline"
        disabled={archived || pending}
        className="w-full justify-center gap-2 sm:w-auto"
        onClick={openAralPicker}
      >
        <UserRoundCog className="h-4 w-4" aria-hidden />
        Transfer tutor
      </Button>
    ) : null;

  /**
   * Nothing to fetch and nothing to clear: the profile row the dialog already
   * holds is everything the form needs, so Edit is a mode flip.
   */
  const startEdit = () => setMode("edit");

  const cancelEdit = () => {
    if (editOnly) onClose();
    else setMode("view");
  };

  /**
   * The saved row is re-read rather than patched from the form: `updateLearner`
   * derives fullName and reconciles the enrollment pointers, so the dialog's own
   * copy would be a guess. The form has already toasted and refreshed the route.
   */
  const handleSaved = () => {
    if (editOnly) {
      onClose();
      return;
    }
    setMode("view");
    if (learnerId) void load(learnerId);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl">
        <header className="flex items-start gap-3 border-b border-border px-5 py-4 pr-14 sm:px-6">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {editing ? (
              <Pencil className="h-5 w-5" aria-hidden />
            ) : (
              <UserRound className="h-5 w-5" aria-hidden />
            )}
          </span>
          <div className="min-w-0">
            {/* The heading names the mode, so a teacher mid-edit can tell at a
                glance that this is no longer the read-only view. */}
            <DialogTitle>
              {editing ? "Edit learner" : "Student Profile"}
            </DialogTitle>
            <DialogDescription className="mt-0.5">
              {editing
                ? learner
                  ? `Update ${learner.fullName}'s Section A + B profile.`
                  : "Update the Section A + B profile."
                : "View detailed information about the learner."}
            </DialogDescription>
          </div>
        </header>

        {editing ? (
          learner ? (
            <LearnerForm
              gradeLevelId={learner.gradeLevelId}
              gradeType={learner.gradeType}
              placement={{
                gradeLabel:
                  GRADE_LEVEL_LABELS[learner.gradeType] ?? learner.gradeType,
                sectionName: learner.sectionName,
              }}
              mode="edit"
              submitLabel="Save changes"
              defaultValues={{
                id: learner.id,
                firstName: learner.firstName,
                middleName: learner.middleName,
                lastName: learner.lastName,
                age: learner.age,
                gender: learner.gender,
                ethnicity: learner.ethnicity,
                ethnicityOther: learner.ethnicityOther,
                englishReadingProfile: learner.englishReadingProfile,
                englishFrustrationSubtypes: learner.englishFrustrationSubtypes,
                filipinoReadingProfile: learner.filipinoReadingProfile,
                filipinoFrustrationSubtypes:
                  learner.filipinoFrustrationSubtypes,
                governmentBenefits: learner.governmentBenefits,
                parentEducation: learner.parentEducation,
                modeOfTransportation: learner.modeOfTransportation,
                distanceHomeToSchool: learner.distanceHomeToSchool,
                previousTransfers: learner.previousTransfers,
                transferDetails: learner.transferDetails,
              }}
              onSaved={handleSaved}
              onCancel={cancelEdit}
            />
          ) : (
            // The form owns the footer once it renders, so these two waiting
            // states must draw their own way back — otherwise a teacher whose
            // profile read failed is stranded with only the ✕.
            <>
              {error ? (
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {error}
                  </p>
                </div>
              ) : (
                <FormSectionsSkeleton showBar={false} />
              )}
              <footer className="flex border-t border-border bg-muted/30 px-5 py-4 sm:justify-end sm:px-6">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-center sm:w-auto"
                  onClick={cancelEdit}
                >
                  {editOnly ? "Close" : "Back to profile"}
                </Button>
              </footer>
            </>
          )
        ) : (
          <>
            <ProfileTabs active={tab} onChange={setTab} />

            <div
              role="tabpanel"
              id={panelId(tab)}
              aria-labelledby={tabId(tab)}
              tabIndex={0}
              className="min-h-0 flex-1 overflow-y-auto px-5 py-5 focus-visible:outline-none sm:px-6"
            >
              {loading && !learner ? (
                <ProfileSkeleton />
              ) : error ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {error}
                </p>
              ) : learner ? (
                <PanelFor tab={tab} learner={learner} />
              ) : null}
            </div>

            {/* Drawn once, from the first frame: a teacher sees the three actions
                while the row is still loading, disabled until it lands, so the
                footer never swaps a lone Close for three buttons mid-load. Only a
                failed read collapses to Close — there is nothing left to act on. */}
            <footer className="flex flex-col gap-2 border-t border-border bg-muted/30 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
              {showActions ? (
                <>
                  {/* Teachers cannot transfer learners — `transferLearner` is
                      School-Head-only. The control is drawn where the comp puts it
                      and stays disabled until the teacher-facing flow exists. */}
                  <span
                    className="w-full sm:w-auto"
                    title="Transfers are handled by your School Head. Coming soon for teachers."
                  >
                    <Button
                      type="button"
                      variant="outline"
                      disabled
                      className="w-full justify-center gap-2"
                    >
                      <ArrowLeftRight className="h-4 w-4" aria-hidden />
                      Transfer student
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Soon
                      </span>
                    </Button>
                  </span>

                  {transferTutorButton}

                  {/* Only removal is a confirmation. Enrolment opens the picker
                      from the button itself, because naming a tutor is a choice
                      and a confirm sheet has nothing to offer it. */}
                  {learner && aralEnrolled ? (
                    <ConfirmAction
                      title={`Remove ${learner.fullName} from ARAL?`}
                      description="The learner keeps their reading records but leaves the ARAL roster and weekly grids."
                      confirmLabel="Remove from ARAL"
                      variant="destructive"
                      disabled={archived || pending}
                      onConfirm={handleRemoveFromAral}
                      trigger={aralButton}
                    />
                  ) : (
                    aralButton
                  )}

                  <Button
                    type="button"
                    disabled={learner === null || archived}
                    className="justify-center gap-2"
                    onClick={startEdit}
                  >
                    <Pencil className="h-4 w-4" aria-hidden />
                    Edit
                  </Button>
                </>
              ) : (
                <Button type="button" variant="outline" onClick={onClose}>
                  Close
                </Button>
              )}
            </footer>
          </>
        )}

        {/* Nested on purpose, the way this footer's confirm sheets already are:
            the picker belongs to one learner, so it closes with the dialog that
            opened it, and closing it leaves that dialog standing. A completed
            write re-reads the row, so the tutor's name and the enrolment status
            change in place rather than waiting for the next visit. */}
        <AssignAralTutorDialog
          target={aralTarget}
          onClose={() => setAralTarget(null)}
          onDone={() => {
            if (learnerId) void load(learnerId);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function PanelFor({
  tab,
  learner,
}: {
  tab: ProfileTabKey;
  learner: LearnerProfileData;
}) {
  switch (tab) {
    case "attendance":
      return <AttendancePanel learner={learner} />;
    case "reading":
      return <ReadingPanel learner={learner} />;
    case "grades":
      return <GradesPanel />;
    case "aral":
      return <AralPanel learner={learner} />;
    case "profile":
    default:
      return <ProfilePanel learner={learner} />;
  }
}

/** Holds the Profile tab's two-column geometry while the row loads. */
function ProfileSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      <div className="flex flex-col items-center gap-4 rounded-xl border border-border/80 bg-muted/30 px-4 py-6">
        <Skeleton className="size-24 rounded-full" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-28" />
        <div className="w-full space-y-3 pt-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
      <div className="space-y-4">
        <Skeleton className="h-44 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
