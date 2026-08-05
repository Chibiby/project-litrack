"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createTeacherDirect } from "@/lib/actions/school-head";
import { Card, CardContent } from "@/components/ui/card";
import { Copy, CheckCircle2 } from "lucide-react";

export function InviteTeacherForm({
  grades,
  schoolId,
}: {
  grades: { id: string; label: string }[];
  /** Required when Super Admin is acting in a school context. */
  schoolId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [credentials, setCredentials] = useState<{ username: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (credentials) {
      navigator.clipboard.writeText(`Username: ${credentials.username}\nPassword: ${credentials.password}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      <form
        action={(fd) =>
          startTransition(async () => {
            try {
              if (schoolId) fd.set("schoolId", schoolId);
              const result = await createTeacherDirect(fd);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              setCredentials({ username: result.username, password: result.tempPassword });
              toast.success("Teacher account created");
              (document.getElementById("invite-form") as HTMLFormElement)?.reset();
            } catch (e) {
              const message = e instanceof Error ? e.message : "Failed to create teacher";
              toast.error(message);
            }
          })
        }
        id="invite-form"
        className="space-y-4"
      >
        {schoolId ? <input type="hidden" name="schoolId" value={schoolId} /> : null}
        <div className="space-y-2">
          <Label htmlFor="gradeLevelId">Grade level *</Label>
          <Select name="gradeLevelId" required>
            <SelectTrigger id="gradeLevelId">
              <SelectValue placeholder="Choose grade" />
            </SelectTrigger>
            <SelectContent>
              {grades.map((g) => <SelectItem key={g.id} value={g.id}>{g.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
        <p className="text-xs text-muted-foreground">
          A username and temporary password will be generated. Share these credentials with the teacher.
        </p>
        <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create teacher account"}</Button>
      </form>

      {credentials && (
        <Card className="mt-4 border-border bg-amber-muted">
          <CardContent className="space-y-3 pt-4">
            <div className="flex items-center gap-2 font-semibold text-amber-foreground">
              <CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true" />
              Teacher account created successfully!
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center p-2 bg-white rounded border">
                <span><strong>Username:</strong> {credentials.username}</span>
              </div>
              <div className="flex justify-between items-center p-2 bg-white rounded border">
                <span><strong>Temp Password:</strong> {credentials.password}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Share these credentials with the teacher. Ask them to change the password after first login.
            </p>
            <Button size="sm" variant="outline" onClick={handleCopy} className="w-full">
              {copied ? <CheckCircle2 className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
              {copied ? "Copied!" : "Copy credentials"}
            </Button>
          </CardContent>
        </Card>
      )}
    </>
  );
}
