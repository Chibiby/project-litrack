"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "@/lib/actions/auth";

const SUCCESS_MESSAGE =
  "If an account exists for that email, a reset link has been sent.";

export function ForgotPasswordForm() {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <Card className="rounded-xl border border-border/80 bg-white shadow-sm">
        <CardContent className="space-y-4 pt-6">
          <h2 className="text-lg font-semibold">Check your email</h2>
          <p className="text-sm text-muted-foreground">{SUCCESS_MESSAGE}</p>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Back to login</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border border-border/80 bg-white shadow-sm">
      <CardContent className="space-y-4 pt-6">
        <h2 className="text-lg font-semibold">Reset password</h2>
        <p className="text-sm text-muted-foreground">
          Enter the email on your account. School Head and teacher accounts without email: contact
          your administrator to regenerate credentials.
        </p>
        <form
          action={(fd) =>
            startTransition(async () => {
              const res = await requestPasswordReset(fd);
              if (!res.ok) {
                toast.error(res.error);
                return;
              }
              setDone(true);
            })
          }
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoFocus />
          </div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Sending…" : "Send reset link"}
          </Button>
        </form>
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/login" className="underline hover:text-foreground">
            Back to login
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
