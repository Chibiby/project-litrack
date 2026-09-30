"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldRadioGroup } from "./profile-shared";
import {
  READING_PROFILE_LABELS,
  readingProfileLabelsForGradeType,
  toOptions,
} from "@/lib/constants/enum-labels";
import { recordReadingLevel } from "@/lib/actions/reading-level";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";
import { formatLocalDateKey } from "@/lib/date-keys";
import { getMonday } from "@/lib/utils";

export function ReadingLevelForm({
  learnerId,
  gradeType,
}: {
  learnerId: string;
  gradeType?: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const currentWeek = formatLocalDateKey(getMonday(new Date()));
  const profileOptions = toOptions(
    gradeType
      ? readingProfileLabelsForGradeType(gradeType)
      : READING_PROFILE_LABELS
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        fd.set("learnerId", learnerId);
        startTransition(async () => {
          const res = await callAction(() => recordReadingLevel(fd));
          if (res.ok) {
            toast.success("Reading level saved");
            form.reset();
          } else toastFailure(res);
        });
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <Label htmlFor="weekStart">Week of (Monday) *</Label>
        <Input
          id="weekStart"
          name="weekStart"
          type="date"
          defaultValue={currentWeek}
          required
        />
      </div>
      <div>
        <p className="text-sm font-medium mb-2">English *</p>
        <FieldRadioGroup name="englishProfile" options={profileOptions} />
      </div>
      <div>
        <p className="text-sm font-medium mb-2">Filipino *</p>
        <FieldRadioGroup name="filipinoProfile" options={profileOptions} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={2} />
      </div>
      <Button
        type="submit"
        loading={pending}
        loadingText="Saving…"
        className="w-full"
      >
        Save reading level
      </Button>
    </form>
  );
}
