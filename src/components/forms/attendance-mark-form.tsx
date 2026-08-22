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
        <Input id="date" name="date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
      </div>
      <div>
        <p className="text-sm font-medium mb-2">Status *</p>
        <FieldRadioGroup name="status" options={toOptions(ATTENDANCE_STATUS_LABELS)} />
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
        Save
      </Button>
    </form>
  );
}
