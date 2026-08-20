"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LearnerProfileModal } from "@/components/learners/learner-profile-modal";

/**
 * Edit, on the learner detail page, as a dialog rather than a route.
 *
 * The standalone edit page is gone: the learner form now lives in the Student
 * Profile dialog, and this island opens that dialog straight into it. Cancel and
 * a completed save close it, leaving the teacher on the detail page they started
 * from — which `updateLearner`'s revalidate has already refreshed.
 *
 * Rendered only for a teacher on an unarchived learner; the page decides both.
 */
export function LearnerEditButton({
  learnerId,
  isAralLearner = false,
}: {
  learnerId: string;
  /** Names the dialog's ARAL action correctly if the teacher backs out to it. */
  isAralLearner?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
      >
        <Pencil className="h-4 w-4" /> Edit
      </Button>
      <LearnerProfileModal
        learnerId={open ? learnerId : null}
        onClose={() => setOpen(false)}
        isSuperAdmin={false}
        initialIsAralLearner={isAralLearner}
        initialMode="edit"
      />
    </>
  );
}
