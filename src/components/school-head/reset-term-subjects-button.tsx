"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { resetSchoolTermSubjects } from "@/lib/actions/term-subjects";

/**
 * School-wide "Reset to default" for the End of Terms subject lists.
 *
 * `TermSubjectsManager` (rendered per grade below this button) seeds its
 * `useOptimistic` state once from the props it mounted with, keyed by
 * `selected.id` — a plain `router.refresh()` would deliver fresh
 * `initialActive`/`initialArchived` props to an instance that never re-seeds
 * from them. Bumping `resetVersion` in the URL instead forces Next.js to
 * fetch a brand-new RSC payload for a new key, so the freshly-reset data and
 * the remount always arrive together — there is no window where a remount
 * fires before the new data is ready.
 */
export function ResetTermSubjectsButton({
  schoolId,
}: {
  /** Only set for a Super Admin's drill-down; a School Head's own reset never posts one. */
  schoolId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  async function handleConfirm() {
    const res = await resetSchoolTermSubjects({ schoolId });
    if (!res.ok) {
      toast.error(res.error);
      throw new Error(res.error);
    }

    const { grades, created, restored, archived } = res.data;
    toast.success(
      `Reset ${grades} grade${grades === 1 ? "" : "s"}: ${created} added, ${restored} restored, ${archived} archived.`
    );

    const params = new URLSearchParams(searchParams);
    const nextVersion = (Number(params.get("resetVersion")) || 0) + 1;
    params.set("resetVersion", String(nextVersion));
    router.push(`${pathname}?${params.toString()}`);
    router.refresh();
  }

  return (
    <ConfirmAction
      title="Reset to default subjects?"
      description="Every grade's End of Terms sheet resets to that grade level's default subject list. Subjects not on the list are removed from the sheet — recorded scores are kept and come back if the subject is restored. Grades already entered keep their scores."
      confirmLabel="Reset"
      variant="destructive"
      trigger={
        <Button type="button" size="sm" variant="outline">
          <RotateCcw className="h-4 w-4" aria-hidden />
          Reset to default
        </Button>
      }
      onConfirm={handleConfirm}
    />
  );
}
