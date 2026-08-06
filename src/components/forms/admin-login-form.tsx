"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { loginAdmin } from "@/lib/actions/auth";

export function AdminLoginForm({ disabled = false }: { disabled?: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <Card className="rounded-xl border border-border/80 bg-white shadow-sm">
      <CardContent className="pt-6">
        <form
          action={(fd) =>
            startTransition(async () => {
              const res = await loginAdmin(fd);
              if (res && !res.ok) toast.error(res.error);
            })
          }
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoFocus
              disabled={disabled || pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              name="password"
              required
              disabled={disabled || pending}
            />
          </div>
          <Button type="submit" className="w-full" disabled={disabled || pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            <Link href="/forgot-password" className="underline hover:text-foreground">
              Forgot password?
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
