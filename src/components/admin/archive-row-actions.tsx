"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import {
  restoreRemovedLearner,
  purgeRemovedLearner,
  restoreRemovedTeacher,
  purgeRemovedTeacher,
} from "@/lib/actions/admin-archive";
import type {
  ArchivedLearnerRow,
  ArchivedTeacherRow,
} from "@/lib/admin/archive";

/**
 * "Account restored. It cannot sign in yet — have the School Head send a new
 * invite, or ask the teacher to register again with their email." — the
 * single most surprising outcome in this feature, said the same way in the
 * dialog before the click and in the toast after it, so nobody discovers it
 * by trying to log in.
 */
const TEACHER_RESTORE_NOTICE =
  "it cannot sign in yet — have the School Head send a new invite, or ask the teacher to register again with their email.";

function pluralize(count: number, singular: string, plural: string): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

function joinParts(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function LearnerRowActions({ learner }: { learner: ArchivedLearnerRow }) {
  const router = useRouter();
  const { purgeCounts } = learner;

  const purgeDescription =
    `Permanently delete ${learner.fullName}? This removes the learner and all ` +
    `${joinParts([
      pluralize(purgeCounts.attendance, "attendance record", "attendance records"),
      pluralize(purgeCounts.readingLevelRecord, "reading assessment", "reading assessments"),
      pluralize(purgeCounts.termGrade, "term grade", "term grades"),
      pluralize(purgeCounts.aralProfile, "ARAL profile", "ARAL profiles"),
      pluralize(purgeCounts.enrollment, "enrolment", "enrolments"),
    ])}. The audit log keeps a record that this happened. This cannot be undone.`;

  const restore = async () => {
    const fd = new FormData();
    fd.set("id", learner.id);
    const res = await restoreRemovedLearner(fd);
    if (!res.ok) {
      toast.error(res.error);
      throw new Error(res.error);
    }
    toast.success(
      res.enrollmentOutcome === "no-active-year"
        ? `${learner.fullName} restored. No active school year, so no enrolment was created.`
        : `${learner.fullName} restored.`
    );
    router.refresh();
  };

  const purge = async () => {
    const fd = new FormData();
    fd.set("id", learner.id);
    const res = await purgeRemovedLearner(fd);
    if (!res.ok) {
      toast.error(res.error);
      throw new Error(res.error);
    }
    toast.success(`${learner.fullName} permanently deleted.`);
    router.refresh();
  };

  return (
    <div className="flex justify-end gap-2">
      <ConfirmAction
        title="Restore this learner?"
        description={`Restore ${learner.fullName}? This clears the removal and returns the learner to ${learner.schoolName}'s active roster.`}
        confirmLabel="Restore"
        variant="default"
        disabled={learner.schoolDeleted}
        trigger={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={learner.schoolDeleted}
            aria-label={`Restore ${learner.fullName}`}
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
          </Button>
        }
        onConfirm={restore}
      />
      <ConfirmAction
        title="Delete permanently"
        description={purgeDescription}
        confirmLabel="Delete permanently"
        variant="destructive"
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            aria-label={`Permanently delete ${learner.fullName}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        }
        onConfirm={purge}
      />
    </div>
  );
}

export function TeacherRowActions({ teacher }: { teacher: ArchivedTeacherRow }) {
  const router = useRouter();

  const purgeDescription =
    `Permanently delete ${teacher.fullName}'s account? Every attendance mark, assessment and grade ` +
    `they recorded stays in place, but the name of who recorded it is blanked. ` +
    `The audit log keeps a record that this happened. This cannot be undone.`;

  const restore = async () => {
    const fd = new FormData();
    fd.set("id", teacher.id);
    const res = await restoreRemovedTeacher(fd);
    if (!res.ok) {
      toast.error(res.error);
      throw new Error(res.error);
    }
    toast.success(`Account restored — ${TEACHER_RESTORE_NOTICE}`);
    router.refresh();
  };

  const purge = async () => {
    const fd = new FormData();
    fd.set("id", teacher.id);
    const res = await purgeRemovedTeacher(fd);
    if (!res.ok) {
      toast.error(res.error);
      throw new Error(res.error);
    }
    toast.success(`${teacher.fullName}'s account permanently deleted.`);
    router.refresh();
  };

  return (
    <div className="flex justify-end gap-2">
      <ConfirmAction
        title="Restore this account?"
        description={`Restore ${teacher.fullName}'s account? The account comes back, but ${TEACHER_RESTORE_NOTICE}`}
        confirmLabel="Restore account"
        variant="default"
        disabled={teacher.schoolDeleted}
        trigger={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={teacher.schoolDeleted}
            aria-label={`Restore ${teacher.fullName}`}
          >
            <RotateCcw className="h-4 w-4" aria-hidden />
          </Button>
        }
        onConfirm={restore}
      />
      <ConfirmAction
        title="Delete permanently"
        description={purgeDescription}
        confirmLabel="Delete permanently"
        variant="destructive"
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            aria-label={`Permanently delete ${teacher.fullName}`}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        }
        onConfirm={purge}
      />
    </div>
  );
}
