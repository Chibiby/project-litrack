"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptTeacherInvite } from "@/lib/actions/auth";

export function TeacherSetupForm({ token, email, name }: { token: string; email: string; name: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardContent className="pt-6">
        <form
          action={(fd) => {
            fd.set("token", token);
            startTransition(async () => {
              const res = await acceptTeacherInvite(fd);
              if (res && !res.ok) toast.error(res.error);
            });
          }}
          className="space-y-4"
        >
          <div className="space-y-1">
            <Label>Name</Label>
            <p className="text-sm">{name}</p>
          </div>
          <div className="space-y-1">
            <Label>Email</Label>
            <p className="text-sm">{email}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Choose a password *</Label>
            <Input id="password" name="password" type="password" required minLength={8} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password *</Label>
            <Input id="confirmPassword" name="confirmPassword" type="password" required minLength={8} />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Setting up…" : "Create account & sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
