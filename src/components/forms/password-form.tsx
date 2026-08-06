"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { setPasswordAction, changePasswordAction, completePasswordReset } from "@/lib/actions/auth";

type Mode = "set" | "change" | "reset";

export function PasswordForm({ mode }: { mode: Mode }) {
  const [pending, startTransition] = useTransition();

  const title =
    mode === "set"
      ? "Set your password"
      : mode === "reset"
        ? "Choose a new password"
        : "Change password";

  const action =
    mode === "set" ? setPasswordAction : mode === "reset" ? completePasswordReset : changePasswordAction;

  return (
    <Card className="rounded-xl border border-border/80 bg-white shadow-sm">
      <CardContent className="space-y-4 pt-6">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">
          Use at least 8 characters with a letter and a number.
        </p>
        <form
          action={(fd) =>
            startTransition(async () => {
              const res = await action(fd);
              if (res && !res.ok) toast.error(res.error);
              else if (mode === "change" && res?.ok) toast.success("Password updated");
            })
          }
          className="space-y-4"
        >
          {mode === "change" ? (
            <div className="space-y-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <PasswordInput id="currentPassword" name="currentPassword" required autoFocus />
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
            <PasswordInput
              id="password"
              name="password"
              required
              minLength={8}
              autoFocus={mode !== "change"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <PasswordInput id="confirmPassword" name="confirmPassword" required minLength={8} />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Saving…" : mode === "change" ? "Update password" : "Save password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
