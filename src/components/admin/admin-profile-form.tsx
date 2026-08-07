"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateAdminProfile } from "@/lib/actions/school-management";

export function AdminProfileForm({
  firstName,
  middleName,
  lastName,
  email,
}: {
  firstName: string;
  middleName: string | null;
  lastName: string;
  email: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-6">
      <form
        className="space-y-4"
        action={(fd) =>
          startTransition(async () => {
            const res = await updateAdminProfile(fd);
            if (!res.ok) toast.error(res.error);
            else toast.success("Profile updated");
          })
        }
      >
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" value={email} disabled readOnly />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              name="firstName"
              defaultValue={firstName}
              required
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="middleName">Middle name</Label>
            <Input
              id="middleName"
              name="middleName"
              defaultValue={middleName ?? ""}
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastName">Last name</Label>
            <Input
              id="lastName"
              name="lastName"
              defaultValue={lastName}
              required
              disabled={pending}
            />
          </div>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
      </form>

      <div className="rounded-lg border border-border/80 bg-muted/30 px-4 py-3 text-sm">
        <p className="font-medium">Password</p>
        <p className="mt-1 text-muted-foreground">
          Change your password from the account page.
        </p>
        <Button asChild variant="outline" size="sm" className="mt-3">
          <Link href="/admin/password" prefetch={true}>
            Change password
          </Link>
        </Button>
      </div>
    </div>
  );
}
