"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { loginSchoolHead, loginTeacher } from "@/lib/actions/auth";

type Mode = "select-role" | "school-head" | "teacher";

type SchoolWithStatus = { id: string; name: string; hasTeachers: boolean };

export function LoginForm({ schools }: { schools: SchoolWithStatus[] }) {
  const [mode, setMode] = useState<Mode>("select-role");
  const [schoolId, setSchoolId] = useState<string>("");
  const [hasTeachers, setHasTeachers] = useState<boolean>(false);
  const [pending, startTransition] = useTransition();

  const handleSchoolChange = (value: string) => {
    setSchoolId(value);
    const selected = schools.find((s) => s.id === value);
    setHasTeachers(selected?.hasTeachers ?? false);
  };

  if (mode === "select-role") {
    return (
      <Card className="rounded-xl border border-border/80 bg-white shadow-sm">
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label>School Name</Label>
            <Select value={schoolId} onValueChange={handleSchoolChange}>
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
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Button
              variant="outline"
              disabled={!schoolId || !hasTeachers}
              onClick={() => setMode("teacher")}
              title={
                !schoolId
                  ? "Select a school first"
                  : !hasTeachers
                    ? "No teachers enrolled yet. School Head must add teachers first."
                    : ""
              }
            >
              Teachers
            </Button>
            <Button disabled={!schoolId} onClick={() => setMode("school-head")}>
              School Head
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {!schoolId
              ? "Select a school to continue."
              : !hasTeachers
                ? "Teachers button disabled until School Head is profiled, grade levels exist, and teachers are enrolled."
                : "Teachers can now log in."}
          </p>
          <p className="text-center text-xs text-muted-foreground pt-1">
            <Link href="/forgot-password" className="underline hover:text-foreground">
              Forgot password?
            </Link>
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
    <Card className="rounded-xl border border-border/80 bg-white shadow-sm">
      <CardContent className="space-y-4 pt-6">
        <button
          className="mb-2 text-xs text-muted-foreground underline"
          onClick={() => setMode("select-role")}
          type="button"
        >
          ← Change school
        </button>

        {mode === "school-head" ? (
          <form action={handleSchoolHeadSubmit} className="space-y-4">
            <h2 className="text-lg font-semibold">School Head Login</h2>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput id="password" name="password" required autoFocus />
              <p className="text-xs text-muted-foreground">
                First time? Use the activation credential from your administrator.
              </p>
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        ) : (
          <form action={handleTeacherSubmit} className="space-y-4">
            <h2 className="text-lg font-semibold">Teacher Login</h2>
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                type="text"
                required
                autoFocus
                placeholder="e.g., teacher.smith.a1b2"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <PasswordInput id="password" name="password" required />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        )}
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/forgot-password" className="underline hover:text-foreground">
            Forgot password?
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
