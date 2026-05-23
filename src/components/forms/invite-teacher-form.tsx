"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inviteTeacher } from "@/lib/actions/school-head";

export function InviteTeacherForm({ grades }: { grades: { id: string; label: string }[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const res = await inviteTeacher(fd);
          if (res.ok) {
            toast.success("Invite sent");
            (document.getElementById("invite-form") as HTMLFormElement)?.reset();
          } else toast.error(res.error);
        })
      }
      id="invite-form"
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label>Grade level *</Label>
        <Select name="gradeLevelId" required>
          <SelectTrigger>
            <SelectValue placeholder="Choose grade" />
          </SelectTrigger>
          <SelectContent>
            {grades.map((g) => <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="firstName">First name *</Label>
          <Input id="firstName" name="firstName" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="middleName">Middle name</Label>
          <Input id="middleName" name="middleName" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last name *</Label>
          <Input id="lastName" name="lastName" required />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email *</Label>
        <Input id="email" name="email" type="email" required />
        <p className="text-xs text-muted-foreground">Teacher will get an email to set their password.</p>
      </div>
      <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send invite"}</Button>
    </form>
  );
}
