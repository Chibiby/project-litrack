"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { acceptTeacherInvite } from "@/lib/actions/auth";

export function TeacherSetupForm({
  token,
  name,
  email,
  usernameHint,
}: {
  token: string;
  name: string;
  email?: string | null;
  usernameHint?: string | null;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Card className="rounded-xl border border-border/80 bg-white shadow-sm">
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
          {email ? (
            <div className="space-y-1">
              <Label>Email</Label>
              <p className="text-sm">{email}</p>
            </div>
          ) : null}
          {usernameHint ? (
            <div className="space-y-1">
              <Label>Username (for login)</Label>
              <p className="font-mono text-sm">{usernameHint}</p>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="password">Choose a password *</Label>
            <PasswordInput id="password" name="password" required minLength={8} autoFocus />
            <p className="text-xs text-muted-foreground">At least 8 characters with a letter and a number.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password *</Label>
            <PasswordInput id="confirmPassword" name="confirmPassword" required minLength={8} />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Saving…" : "Set password & sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
