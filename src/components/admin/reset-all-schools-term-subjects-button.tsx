"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resetAllSchoolsTermSubjects } from "@/lib/actions/term-subjects";

const CONFIRM_TEXT = "RESET";

/**
 * Super Admin only, platform-wide "Reset to default" for the End of Terms
 * subject lists. Unlike `ResetTermSubjectsButton` (one school), this touches
 * every school at once, so it is gated by a typed confirmation rather than a
 * single click-through dialog.
 */
export function ResetAllSchoolsTermSubjectsButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [pending, startTransition] = useTransition();

  const canConfirm = confirmText.trim() === CONFIRM_TEXT;

  function handleOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) setConfirmText("");
  }

  function handleConfirm() {
    if (!canConfirm || pending) return;
    startTransition(async () => {
      const res = await resetAllSchoolsTermSubjects({ confirm: "RESET" });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }

      const { schools, created, restored, archived, failedSchools } = res.data;
      toast.success(
        `Reset ${schools} school${schools === 1 ? "" : "s"}: ${created} added, ${restored} restored, ${archived} archived.`
      );
      if (failedSchools > 0) {
        toast.warning(
          `${failedSchools} school${failedSchools === 1 ? "" : "s"} could not be reset. Check the error log at /admin/errors.`
        );
      }

      setOpen(false);
      setConfirmText("");
      router.refresh();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="lg:h-9">
          <RotateCcw className="h-4 w-4" aria-hidden />
          Reset all schools to default
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset every school to today&rsquo;s defaults?</AlertDialogTitle>
          <AlertDialogDescription>
            Every school&rsquo;s End-of-Term subjects, in every grade level except
            Kindergarten (which uses the competency checklist), go back to the
            current defaults shown on this page. Subjects a school added on its
            own are archived, not deleted, and can be restored later. Grades
            already entered stay attached to their subjects.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            This changes every school on the platform at once and cannot be
            undone from this screen.
          </span>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="reset-all-schools-confirm">
            Type <span className="font-mono">{CONFIRM_TEXT}</span> to confirm
          </Label>
          <Input
            id="reset-all-schools-confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
            placeholder={CONFIRM_TEXT}
            disabled={pending}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={pending || !canConfirm}
            aria-busy={pending || undefined}
            onClick={handleConfirm}
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            Reset all schools
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
