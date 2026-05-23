"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSchool } from "@/lib/actions/school";

export function CreateSchoolForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardContent className="pt-6">
        <form
          action={(fd) =>
            startTransition(async () => {
              try {
                await createSchool(fd);
                toast.success("School created. The School Head can now log in.");
                router.push("/admin/schools");
              } catch (e: any) {
                toast.error(e?.message || "Failed to create school");
              }
            })
          }
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="name">School name *</Label>
            <Input id="name" name="name" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="schoolIdCode">School ID (used as School Head password) *</Label>
            <Input id="schoolIdCode" name="schoolIdCode" required pattern="[A-Za-z0-9_\-]+" minLength={4} />
            <p className="text-xs text-muted-foreground">
              Letters, digits, underscore, dash. Min 4 characters.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="region">Region</Label>
              <Input id="region" name="region" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="division">Division</Label>
              <Input id="division" name="division" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="district">District</Label>
              <Input id="district" name="district" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input id="address" name="address" />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create school"}</Button>
            <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

