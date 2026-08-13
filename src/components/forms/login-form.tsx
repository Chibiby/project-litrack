"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  loginSchoolHead,
  loginTeacher,
  requestTeacherRegisterOtp,
  verifyTeacherRegisterOtp,
} from "@/lib/actions/auth";
import { resetSidebarExpandedPreference } from "@/hooks/use-sidebar-expanded";
import { strongPassword } from "@/lib/validators/auth.schema";
import { POST_LOGIN_FLAG } from "@/lib/post-login-flag";

type Screen = "select-role" | "school-head" | "teacher";
type TeacherIntent = "login" | "register";
type TeacherStep = "credentials" | "otp";

type SchoolWithStatus = { id: string; name: string; teachersOpen: boolean };

const TEACHERS_UNLOCK_HELP =
  "Teachers unlock once the School Head completes profiling and adds grade levels.";

const PASSWORD_HINT = "Use at least 8 characters with a letter and a number.";

/** Kept in sync with REGISTER_PENDING_PATH in @/lib/actions/auth. */
const REGISTER_PENDING_PATH = "/account/created";

/** Mark next app shell paint to show the post-login splash (survives redirect). */
function markPostLoginSplash() {
  try {
    sessionStorage.setItem(POST_LOGIN_FLAG, "1");
  } catch {
    // sessionStorage unavailable — splash simply won't show
  }
}

export function LoginForm({
  schools,
  loginError,
}: {
  schools: SchoolWithStatus[];
  loginError?: string;
}) {
  const [screen, setScreen] = useState<Screen>("select-role");
  const router = useRouter();
  const [schoolId, setSchoolId] = useState("");
  const [teachersOpen, setTeachersOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [teacherIntent, setTeacherIntent] = useState<TeacherIntent>("login");
  const [teacherStep, setTeacherStep] = useState<TeacherStep>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [code, setCode] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  /** Sync lock so double Enter/click cannot start two OTP verifies before `pending` re-renders. */
  const verifyRegisterLock = useRef(false);

  useEffect(() => {
    if (loginError) toast.error(loginError);
  }, [loginError]);

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
    setPassword("");
    setConfirmPassword("");
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
    setPassword("");
    setConfirmPassword("");
    setCode("");
    setResendSeconds(0);
  };

  const buildRegisterFormData = (includeCode = false) => {
    const formData = new FormData();
    formData.set("schoolId", schoolId);
    formData.set("email", email.trim());
    formData.set("firstName", firstName.trim());
    formData.set("middleName", middleName.trim());
    formData.set("lastName", lastName.trim());
    formData.set("password", password);
    formData.set("confirmPassword", confirmPassword);
    if (includeCode) formData.set("code", code.trim());
    return formData;
  };

  const handleTeacherLogin = () => {
    const formData = new FormData();
    formData.set("schoolId", schoolId);
    formData.set("email", email.trim());
    formData.set("password", password);

    startTransition(async () => {
      try {
        const res = await loginTeacher(formData);
        if (res && !res.ok) {
          toast.error(res.error);
          return;
        }
        markPostLoginSplash();
        resetSidebarExpandedPreference();
      } catch (err) {
        if (isRedirectError(err)) {
          markPostLoginSplash();
          resetSidebarExpandedPreference();
          throw err;
        }
        throw err;
      }
    });
  };

  const handleRequestRegisterOtp = () => {
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    const strength = strongPassword.safeParse(password);
    if (!strength.success) {
      toast.error(strength.error.errors[0]?.message ?? PASSWORD_HINT);
      return;
    }

    startTransition(async () => {
      const res = await requestTeacherRegisterOtp(buildRegisterFormData());
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setTeacherStep("otp");
      setCode("");
      setResendSeconds(60);
    });
  };

  const handleVerifyRegisterOtp = () => {
    if (pending || verifyRegisterLock.current) return;
    verifyRegisterLock.current = true;
    startTransition(async () => {
      try {
        const res = await verifyTeacherRegisterOtp(buildRegisterFormData(true));
        if (!res.ok) {
          toast.error(res.error);
          verifyRegisterLock.current = false;
          return;
        }
        // Approved accounts land in the app shell (splash); pending accounts get
        // the "Account created" page, which is a plain page and needs no splash.
        if (res.redirectTo !== REGISTER_PENDING_PATH) {
          markPostLoginSplash();
          resetSidebarExpandedPreference();
        }
        // Navigate here rather than redirecting inside the action: the browser
        // applies the new session cookies first, so the destination sees the
        // session instead of bouncing back to /login.
        // Lock stays held — the page is navigating away.
        router.replace(res.redirectTo);
      } catch (err) {
        console.error("[login-form] teacher register verify failed:", err);
        verifyRegisterLock.current = false;
        toast.error("Could not create your account. Please try again.");
      }
    });
  };

  const handleResendCode = () => {
    if (resendSeconds > 0) return;

    startTransition(async () => {
      const res = await requestTeacherRegisterOtp(buildRegisterFormData());
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setResendSeconds(60);
      toast.success("Code resent");
    });
  };

  const handleSchoolHeadSubmit = (formData: FormData) => {
    formData.set("schoolId", schoolId);
    startTransition(async () => {
      try {
        const res = await loginSchoolHead(formData);
        if (res && !res.ok) {
          toast.error(res.error);
          return;
        }
        markPostLoginSplash();
        resetSidebarExpandedPreference();
      } catch (err) {
        if (isRedirectError(err)) {
          markPostLoginSplash();
          resetSidebarExpandedPreference();
          throw err;
        }
        throw err;
      }
    });
  };

  if (screen === "select-role") {
    return (
      <Card className="rounded-xl border border-border/80 shadow-sm">
        <CardContent className="space-y-4 pt-6">
          <div className="space-y-2">
            <Label htmlFor="login-school">School Name</Label>
            <Select value={schoolId} onValueChange={handleSchoolChange}>
              <SelectTrigger id="login-school">
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
    <Card className="rounded-xl border border-border/80 shadow-sm">
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
              <h2 className="text-lg font-semibold">School Head sign in</h2>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password"
                  name="password"
                  required
                  autoFocus
                  autoComplete="current-password"
                />
                <p className="text-xs text-muted-foreground">
                  First time? Use the activation credential from your administrator. Teachers create
                  their own password when registering — School Heads use the school credential.
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
              {teacherIntent === "login" ? "Teacher sign in" : "Create teacher account"}
            </h2>
            {teacherIntent === "register" ? (
              <p className="text-xs text-muted-foreground">
                New teachers set a password and verify email with a one-time code. After creation,
                sign in with email and password only — no code needed for ongoing login.
              </p>
            ) : null}

            {teacherStep !== "otp" ? (
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/40 p-1">
                <Button
                  type="button"
                  size="sm"
                  variant={teacherIntent === "login" ? "default" : "ghost"}
                  className="w-full"
                  disabled={pending}
                  onClick={() => switchTeacherIntent("login")}
                >
                  Sign in
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
            ) : null}

            {teacherIntent === "login" ? (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleTeacherLogin();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    required
                    autoFocus
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={pending}
                    placeholder="you@school.edu"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="teacherPassword">Password</Label>
                  <PasswordInput
                    id="teacherPassword"
                    name="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={pending}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={pending}>
                  {pending ? "Signing in…" : "Sign in"}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  <Link href="/forgot-password" className="underline hover:text-foreground">
                    Forgot password?
                  </Link>
                </p>
              </form>
            ) : teacherStep === "credentials" ? (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleRequestRegisterOtp();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="firstName">First name</Label>
                  <Input
                    id="firstName"
                    name="firstName"
                    required
                    autoFocus
                    autoComplete="given-name"
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
                    autoComplete="additional-name"
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
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    disabled={pending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="registerEmail">Email</Label>
                  <Input
                    id="registerEmail"
                    name="email"
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={pending}
                    placeholder="you@school.edu"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="registerPassword">Password</Label>
                  <PasswordInput
                    id="registerPassword"
                    name="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={pending}
                  />
                  <p className="text-xs text-muted-foreground">{PASSWORD_HINT}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <PasswordInput
                    id="confirmPassword"
                    name="confirmPassword"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={pending}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={pending}>
                  {pending ? "Sending…" : "Send verification code"}
                </Button>
              </form>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleVerifyRegisterOtp();
                }}
              >
                <p className="text-sm text-muted-foreground">
                  Enter the 6-digit code sent to{" "}
                  <span className="font-medium text-foreground">{email}</span>. This
                  code is for account creation and email verification only.
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
                  {pending ? "Creating account…" : "Create account"}
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
                    Edit details
                  </button>
                </p>
              </form>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
