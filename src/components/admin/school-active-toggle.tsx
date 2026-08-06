"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setSchoolActive } from "@/lib/actions/school-management";

export function SchoolActiveToggle({
  schoolId,
  isActive,
  schoolName,
}: {
  schoolId: string;
  isActive: boolean;
  schoolName: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={pending}
      title={isActive ? "Deactivate school" : "Activate school"}
      onClick={() => {
        const next = !isActive;
        if (
          !window.confirm(
            next
              ? `Activate ${schoolName}?`
              : `Deactivate ${schoolName}? Login for this school will be blocked while inactive.`
          )
        ) {
          return;
        }
        const fd = new FormData();
        fd.set("schoolId", schoolId);
        fd.set("isActive", next ? "true" : "false");
        startTransition(async () => {
          const res = await setSchoolActive(fd);
          if (!res.ok) toast.error(res.error);
          else toast.success(next ? "School activated" : "School deactivated");
        });
      }}
    >
      {isActive ? "Deactivate" : "Activate"}
    </Button>
  );
}
