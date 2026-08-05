"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FieldRadioGroup } from "./profile-shared";
import { ATTENDANCE_STATUS_LABELS, toOptions } from "@/lib/constants/enum-labels";
import { markAttendance } from "@/lib/actions/attendance";
import { formatLocalDateYmd } from "@/lib/date-local";

export function AttendanceMarkForm({ learnerId }: { learnerId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) => {
        fd.set("learnerId", learnerId);
        startTransition(async () => {
          const res = await markAttendance(fd);
          if (res.ok) toast.success("Attendance saved");
          else toast.error(res.error);
        });
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <Label htmlFor="date">Date *</Label>
        {/* Local YYYY-MM-DD — avoid toISOString() which shifts the day in UTC+8 */}
        <Input id="date" name="date" type="date" required defaultValue={formatLocalDateYmd()} />
      </div>
      <fieldset>
        <legend id="attendance-status-legend" className="mb-2 text-sm font-medium">Status *</legend>
        <FieldRadioGroup aria-labelledby="attendance-status-legend" name="status" options={toOptions(ATTENDANCE_STATUS_LABELS)} />
      </fieldset>
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
