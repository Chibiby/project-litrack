"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inviteTeacher } from "@/lib/actions/school-head";
import { Card, CardContent } from "@/components/ui/card";
import { Copy, CheckCircle2, AlertTriangle } from "lucide-react";

export function InviteTeacherForm({ grades }: { grades: { id: string; label: string }[] }) {
  const [pending, startTransition] = useTransition();
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(
    null
  );
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (credentials) {
      void navigator.clipboard.writeText(
        `Username: ${credentials.username}\nTemp password: ${credentials.password}`
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      <form
        action={(fd) =>
          startTransition(async () => {
            const result = await inviteTeacher(fd);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            if (result.data) {
              setCredentials({
                username: result.data.username,
                password: result.data.tempPassword,
              });
              toast.success("Teacher account created");
              (document.getElementById("invite-form") as HTMLFormElement | null)?.reset();
            }
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
              {grades.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.label}
                </SelectItem>
              ))}
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
          <Label htmlFor="email">Email (optional)</Label>
          <Input id="email" name="email" type="email" placeholder="teacher@example.com" />
          <p className="text-xs text-muted-foreground">
            If provided, a setup link is emailed. Username and temporary password are always shown
            once below.
          </p>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Add teacher"}
        </Button>
      </form>

      {credentials && (
        <Card className="mt-4 border-amber-200 bg-amber-50">
          <CardContent className="space-y-3 pt-4">
            <div className="flex items-center gap-2 font-semibold text-amber-950">
              <AlertTriangle className="h-5 w-5" />
              Credentials (shown once)
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between rounded border bg-white p-2">
                <span>
                  <strong>Username:</strong> {credentials.username}
                </span>
              </div>
              <div className="flex items-center justify-between rounded border bg-white p-2">
                <span>
                  <strong>Temp password:</strong> {credentials.password}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Share securely. The teacher must change this password on first login (or via the email
              setup link if sent).
            </p>
            <Button size="sm" variant="outline" onClick={handleCopy} className="w-full">
              {copied ? (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              {copied ? "Copied!" : "Copy credentials"}
            </Button>
          </CardContent>
        </Card>
      )}
    </>
  );
}
