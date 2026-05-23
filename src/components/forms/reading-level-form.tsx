"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldRadioGroup } from "./profile-shared";
import { READING_PROFILE_LABELS, toOptions } from "@/lib/constants/enum-labels";
import { recordReadingLevel } from "@/lib/actions/reading-level";
import { monthYearKey } from "@/lib/utils";

export function ReadingLevelForm({ learnerId }: { learnerId: string }) {
  const [pending, startTransition] = useTransition();
  const currentMonth = monthYearKey(new Date());

  return (
    <form
      action={(fd) => {
        fd.set("learnerId", learnerId);
        startTransition(async () => {
          const res = await recordReadingLevel(fd);
          if (res.ok) toast.success("Reading level saved");
          else toast.error(res.error);
        });
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <Label htmlFor="monthYear">Month *</Label>
        <Input id="monthYear" name="monthYear" placeholder="YYYY-MM" defaultValue={currentMonth} pattern="\d{4}-\d{2}" required />
      </div>
      <div>
        <p className="text-sm font-medium mb-2">English *</p>
        <FieldRadioGroup name="englishProfile" options={toOptions(READING_PROFILE_LABELS)} />
      </div>
      <div>
        <p className="text-sm font-medium mb-2">Filipino *</p>
        <FieldRadioGroup name="filipinoProfile" options={toOptions(READING_PROFILE_LABELS)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" rows={2} />
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
