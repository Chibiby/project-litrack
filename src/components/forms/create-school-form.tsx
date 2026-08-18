"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createSchool } from "@/lib/actions/school";
import { Copy, CheckCircle2, AlertTriangle } from "lucide-react";

export function CreateSchoolForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [initialPassword, setInitialPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (initialPassword) {
    return (
      <Card className="rounded-xl border border-amber-200 bg-amber-50 shadow-sm">
        <CardContent className="space-y-4 pt-6">
          <div className="flex items-start gap-2 text-amber-950">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <h2 className="font-semibold">School created</h2>
              <p className="mt-1 text-sm text-amber-900/90">
                The School Head signs in with this School ID as their password, then chooses
                their own on first login.
              </p>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3 font-mono text-sm break-all">
            {initialPassword}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(initialPassword);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
              {copied ? "Copied" : "Copy School ID"}
            </Button>
            <Button type="button" onClick={() => router.push("/admin/schools")}>
              Done — back to schools
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border border-border/80 shadow-sm">
      <CardContent className="pt-6">
        <form
          action={(fd) =>
            startTransition(async () => {
              const res = await createSchool(fd);
              if (!res.ok) {
                toast.error(res.error);
                return;
              }
              if (res.data?.initialPassword) {
                setInitialPassword(res.data.initialPassword);
                toast.success("School created");
              } else {
                toast.success("School created");
                router.push("/admin/schools");
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
            <Label htmlFor="schoolIdCode">School ID *</Label>
            <Input
              id="schoolIdCode"
              name="schoolIdCode"
              required
              pattern="[A-Za-z0-9_\-]+"
              minLength={6}
            />
            <p className="text-xs text-muted-foreground">
              Public identifier for the school (not a password). Letters, digits, underscore, dash.
              Min 6 characters. This becomes the School Head's first-time password.
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
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create school"}
            </Button>
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
