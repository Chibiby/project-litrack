"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loginSchoolHead, loginTeacher } from "@/lib/actions/auth";

type Mode = "select-role" | "school-head" | "teacher";

export function LoginForm({ schools }: { schools: { id: string; name: string }[] }) {
  const [mode, setMode] = useState<Mode>("select-role");
  const [schoolId, setSchoolId] = useState<string>("");
  const [pending, startTransition] = useTransition();

  if (mode === "select-role") {
    return (
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label>School Name</Label>
            <Select value={schoolId} onValueChange={setSchoolId}>
              <SelectTrigger>
                <SelectValue placeholder="Select your school" />
              </SelectTrigger>
              <SelectContent>
                {schools.length === 0 ? (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    No schools found. Contact admin.
                  </div>
                ) : (
                  schools.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Button
              variant="outline"
              disabled={!schoolId}
              onClick={() => setMode("teacher")}
            >
              Teachers
            </Button>
            <Button disabled={!schoolId} onClick={() => setMode("school-head")}>
              School Head
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Teachers can only log in once they&apos;ve been enrolled by their School Head.
          </p>
        </CardContent>
      </Card>
    );
  }

  const handleSchoolHeadSubmit = (formData: FormData) => {
    formData.set("schoolId", schoolId);
    startTransition(async () => {
      const res = await loginSchoolHead(formData);
      if (res && !res.ok) toast.error(res.error);
    });
  };

  const handleTeacherSubmit = (formData: FormData) => {
    formData.set("schoolId", schoolId);
    startTransition(async () => {
      const res = await loginTeacher(formData);
      if (res && !res.ok) toast.error(res.error);
    });
  };

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <button
          className="text-xs text-muted-foreground underline mb-2"
          onClick={() => setMode("select-role")}
          type="button"
        >
          ← Change school
        </button>

        {mode === "school-head" ? (
          <form action={handleSchoolHeadSubmit} className="space-y-4">
            <h2 className="text-lg font-semibold">School Head Login</h2>
            <div className="space-y-2">
              <Label htmlFor="password">School ID (password)</Label>
              <Input id="password" name="password" type="password" required autoFocus />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        ) : (
          <form action={handleTeacherSubmit} className="space-y-4">
            <h2 className="text-lg font-semibold">Teacher Login</h2>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" required />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
