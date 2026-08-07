"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { GoogleMark } from "@/components/forms/google-mark";
import {
  loginSchoolHead,
  requestTeacherOtp,
  startTeacherGoogleOAuth,
  verifyTeacherOtp,
} from "@/lib/actions/auth";

type Screen = "select-role" | "school-head" | "teacher";
type TeacherIntent = "login" | "register";
type TeacherStep = "credentials" | "otp";

type SchoolWithStatus = { id: string; name: string; teachersOpen: boolean };

const TEACHERS_UNLOCK_HELP =
  "Teachers unlock once the School Head completes profiling and adds grade levels.";

export function LoginForm({
  schools,
  oauthError,
}: {
  schools: SchoolWithStatus[];
  oauthError?: string;
}) {
  const [screen, setScreen] = useState<Screen>("select-role");
  const [schoolId, setSchoolId] = useState("");
  const [teachersOpen, setTeachersOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [teacherIntent, setTeacherIntent] = useState<TeacherIntent>("login");
  const [teacherStep, setTeacherStep] = useState<TeacherStep>("credentials");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [code, setCode] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);

  useEffect(() => {
    if (oauthError) toast.error(oauthError);
  }, [oauthError]);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const id = window.setTimeout(() => setResendSeconds((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [resendSeconds]);

  const handleSchoolChange = (value: string) => {
    setSchoolId(value);
    const selected = schools.find((s) => s.id === value);
    setTeachersOpen(selected?.teachersOpen ?? false);
  };

  const resetTeacherFlow = () => {
    setTeacherIntent("login");
    setTeacherStep("credentials");
    setEmail("");
    setFirstName("");
    setMiddleName("");
    setLastName("");
    setCode("");
    setResendSeconds(0);
  };

  const goBackToSchoolSelect = () => {
    resetTeacherFlow();
    setScreen("select-role");
  };

  const switchTeacherIntent = (intent: TeacherIntent) => {
    setTeacherIntent(intent);
    setTeacherStep("credentials");
    setCode("");
    setResendSeconds(0);
  };

  const appendRegisterNames = (formData: FormData) => {
    if (teacherIntent !== "register") return;
    formData.set("firstName", firstName);
    formData.set("middleName", middleName);
    formData.set("lastName", lastName);
  };

  const handleSendCode = () => {
    const formData = new FormData();
    formData.set("schoolId", schoolId);
    formData.set("email", email.trim());
    formData.set("intent", teacherIntent);
    appendRegisterNames(formData);

    startTransition(async () => {
      const res = await requestTeacherOtp(formData);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setTeacherStep("otp");
      setCode("");
      setResendSeconds(60);
    });
  };

  const handleVerifyCode = () => {
    const formData = new FormData();
    formData.set("schoolId", schoolId);
    formData.set("email", email.trim());
    formData.set("code", code.trim());
    formData.set("intent", teacherIntent);
    appendRegisterNames(formData);

    startTransition(async () => {
      const res = await verifyTeacherOtp(formData);
      if (res && !res.ok) toast.error(res.error);
    });
  };

  const handleResendCode = () => {
    if (resendSeconds > 0) return;
    const formData = new FormData();
    formData.set("schoolId", schoolId);
    formData.set("email", email.trim());
    formData.set("intent", teacherIntent);
    appendRegisterNames(formData);

    startTransition(async () => {
      const res = await requestTeacherOtp(formData);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setResendSeconds(60);
      toast.success("Code resent");
    });
  };

  const handleGoogleOAuth = (formData: FormData) => {
    formData.set("schoolId", schoolId);
    formData.set("intent", teacherIntent);
    startTransition(async () => {
      const res = await startTeacherGoogleOAuth(formData);
      if (res && !res.ok) toast.error(res.error);
    });
  };

  const handleSchoolHeadSubmit = (formData: FormData) => {
    formData.set("schoolId", schoolId);
    startTransition(async () => {
      const res = await loginSchoolHead(formData);
      if (res && !res.ok) toast.error(res.error);
    });
  };

  if (screen === "select-role") {
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
              disabled={!schoolId || !teachersOpen}
              onClick={() => {
                resetTeacherFlow();
                setScreen("teacher");
              }}
              title={
                !schoolId
                  ? "Select a school first"
                  : !teachersOpen
                    ? TEACHERS_UNLOCK_HELP
                    : ""
              }
            >
              Teachers
            </Button>
            <Button disabled={!schoolId} onClick={() => setScreen("school-head")}>
              School Head
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {!schoolId
              ? "Select a school to continue."
              : !teachersOpen
                ? TEACHERS_UNLOCK_HELP
                : "Teachers can sign in or create an account. School Head approval is required for new accounts."}
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

  return (
    <Card className="rounded-xl border border-border/80 bg-white shadow-sm">
      <CardContent className="space-y-4 pt-6">
        <button
          className="mb-2 text-xs text-muted-foreground underline"
          onClick={goBackToSchoolSelect}
          type="button"
        >
          ← Change school
        </button>

        {screen === "school-head" ? (
          <>
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
            <p className="text-center text-xs text-muted-foreground">
              <Link href="/forgot-password" className="underline hover:text-foreground">
                Forgot password?
              </Link>
            </p>
          </>
        ) : (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">
              {teacherIntent === "login" ? "Teacher Login" : "Create Teacher Account"}
            </h2>

            <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1">
              <Button
                type="button"
                size="sm"
                variant={teacherIntent === "login" ? "default" : "ghost"}
                className="w-full"
                disabled={pending}
                onClick={() => switchTeacherIntent("login")}
              >
                Login
              </Button>
              <Button
                type="button"
                size="sm"
                variant={teacherIntent === "register" ? "default" : "ghost"}
                className="w-full"
                disabled={pending}
                onClick={() => switchTeacherIntent("register")}
              >
                Create account
              </Button>
            </div>

            {teacherStep === "credentials" ? (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendCode();
                }}
              >
                {teacherIntent === "register" ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="firstName">First name</Label>
                      <Input
                        id="firstName"
                        name="firstName"
                        required
                        autoFocus
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        disabled={pending}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="middleName">Middle name (optional)</Label>
                      <Input
                        id="middleName"
                        name="middleName"
                        value={middleName}
                        onChange={(e) => setMiddleName(e.target.value)}
                        disabled={pending}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="lastName">Last name</Label>
                      <Input
                        id="lastName"
                        name="lastName"
                        required
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        disabled={pending}
                      />
                    </div>
                  </>
                ) : null}

                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoFocus={teacherIntent === "login"}
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={pending}
                    placeholder="you@school.edu"
                  />
                </div>

                <Button type="submit" className="w-full" disabled={pending}>
                  {pending ? "Sending…" : "Send code"}
                </Button>
              </form>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleVerifyCode();
                }}
              >
                <p className="text-sm text-muted-foreground">
                  Enter the 6-digit code sent to{" "}
                  <span className="font-medium text-foreground">{email}</span>.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="code">Verification code</Label>
                  <Input
                    id="code"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    required
                    autoFocus
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    disabled={pending}
                    className="tracking-[0.3em] text-center text-lg"
                    placeholder="••••••"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={pending || code.length !== 6}
                >
                  {pending ? "Verifying…" : "Verify code"}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  <button
                    type="button"
                    className="underline hover:text-foreground disabled:no-underline disabled:opacity-50"
                    disabled={pending || resendSeconds > 0}
                    onClick={handleResendCode}
                  >
                    {resendSeconds > 0
                      ? `Resend code in ${resendSeconds}s`
                      : "Resend code"}
                  </button>
                  {" · "}
                  <button
                    type="button"
                    className="underline hover:text-foreground"
                    disabled={pending}
                    onClick={() => {
                      setTeacherStep("credentials");
                      setCode("");
                    }}
                  >
                    Use a different email
                  </button>
                </p>
              </form>
            )}

            <div className="relative flex items-center gap-3 py-1">
              <Separator className="flex-1" />
              <span className="text-xs uppercase text-muted-foreground">or</span>
              <Separator className="flex-1" />
            </div>

            <form action={handleGoogleOAuth}>
              <Button
                type="submit"
                variant="outline"
                className="w-full gap-2"
                disabled={pending}
              >
                <GoogleMark />
                Continue with Google
              </Button>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
