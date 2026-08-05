"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteSchool } from "@/lib/actions/school";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export function DeleteSchoolButton({
  schoolId,
  schoolName,
}: {
  schoolId: string;
  schoolName: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          type="button"
          className="text-destructive hover:text-destructive"
          aria-label={`Delete school ${schoolName}`}
          disabled={pending}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete school?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete <strong>{schoolName}</strong> and related data. This action
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={pending}
            onClick={() => {
              const fd = new FormData();
              fd.set("id", schoolId);
              startTransition(async () => {
                try {
                  await deleteSchool(fd);
                  toast.success("School deleted");
                } catch (err) {
                  const message = err instanceof Error ? err.message : "Failed to delete school";
                  toast.error(message);
                }
              });
            }}
          >
            {pending ? "Deleting…" : "Delete school"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
