"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateSchoolInfo } from "@/lib/actions/school-management";

type SchoolInfo = {
  name: string;
  schoolIdCode: string;
  address: string | null;
  region: string | null;
  division: string | null;
  district: string | null;
};

export function SchoolInfoForm({ school }: { school: SchoolInfo }) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="space-y-4"
      action={(fd) =>
        startTransition(async () => {
          const res = await updateSchoolInfo(fd);
          if (!res.ok) toast.error(res.error);
          else toast.success("School information updated");
        })
      }
    >
      <div className="space-y-2">
        <Label htmlFor="schoolIdCode">School ID</Label>
        <Input id="schoolIdCode" value={school.schoolIdCode} disabled readOnly />
        <p className="text-xs text-muted-foreground">School ID cannot be changed.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="name">School name</Label>
        <Input id="name" name="name" defaultValue={school.name} required disabled={pending} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="address">Address</Label>
        <Input id="address" name="address" defaultValue={school.address ?? ""} disabled={pending} />
      </div>
      {/* No `name` attributes: the district decides which district admin
          supervises this school, so only the division office sets these. */}
      <div className="space-y-2">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="region">Region</Label>
            <Input id="region" value={school.region ?? ""} placeholder="—" disabled readOnly />
          </div>
          <div className="space-y-2">
            <Label htmlFor="division">Division</Label>
            <Input id="division" value={school.division ?? ""} placeholder="—" disabled readOnly />
          </div>
          <div className="space-y-2">
            <Label htmlFor="district">District</Label>
            <Input id="district" value={school.district ?? ""} placeholder="—" disabled readOnly />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">Set by the division office.</p>
      </div>
      <Button type="submit" loading={pending} loadingText="Saving…">
        Save changes
      </Button>
    </form>
  );
}
