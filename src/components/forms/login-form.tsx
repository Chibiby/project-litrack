"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  loginSchoolHead,
  loginTeacher,
  requestTeacherRegisterOtp,
  verifyTeacherRegisterOtp,
} from "@/lib/actions/auth";
import { resetSidebarExpandedPreference } from "@/hooks/use-sidebar-expanded";
import { strongPassword } from "@/lib/validators/auth.schema";
import { POST_LOGIN_FLAG } from "@/lib/post-login-flag";
import {
  ALL_DISTRICTS,
  deriveDistricts,
  schoolsInDistrict,
  clearStaleSchool,
} from "@/lib/login/district-filter";

type Screen = "select-role" | "school-head" | "teacher";
type TeacherIntent = "login" | "register";
type TeacherStep = "credentials" | "otp";

type SchoolWithStatus = { id: string; name: string; district: string | null; teachersOpen: boolean };

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
  const [district, setDistrict] = useState<string>(ALL_DISTRICTS);
  const [teachersOpen, setTeachersOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const districts = useMemo(() => deriveDistricts(schools), [schools]);
  const visibleSchools = useMemo(() => schoolsInDistrict(schools, district), [schools, district]);
  // No `hint`: a second line under each school name (the district) is noise once the
  // District filter above already states which district you are looking at.
  const schoolOptions = useMemo(
    () => visibleSchools.map((s) => ({ value: s.id, label: s.name })),
    [visibleSchools]
  );

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

  const handleDistrictChange = (value: string) => {
    setDistrict(value);
    const next = clearStaleSchool(schoolId, schoolsInDistrict(schools, value));
    if (next !== schoolId) {
      // The derived teachersOpen gate must not outlive the selection it came from.
      setSchoolId(next);
      setTeachersOpen(false);
    }
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
          {districts.length > 0 ? (
            <div className="space-y-2">
              <Label htmlFor="login-district">District</Label>
              <Select value={district} onValueChange={handleDistrictChange}>
                <SelectTrigger id="login-district">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_DISTRICTS}>All districts</SelectItem>
                  {districts.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="login-school">School Name</Label>
            {schools.length === 0 ? (
              <p className="rounded-md border border-input bg-background p-4 text-center text-sm text-muted-foreground">
                No schools found. Contact admin.
              </p>
            ) : (
              <SearchableSelect
                id="login-school"
                options={schoolOptions}
                value={schoolId}
                onValueChange={handleSchoolChange}
                placeholder="Select your school"
                searchPlaceholder="Search schools…"
                emptyMessage="No schools match your search."
              />
            )}
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
        <Button
          type="button"
          variant="link"
          size="sm"
          className="mb-2 h-auto p-0 text-xs text-muted-foreground"
          onClick={goBackToSchoolSelect}
        >
          ← Change school
        </Button>

        {screen === "school-head" ? (
          <>
            <form action={handleSchoolHeadSubmit} className="space-y-4">
              <h2 className="text-lg font-semibold">School Head sign in</h2>
              <div className="space-y-2">
                <Label htmlFor="password">School ID or password</Label>
                <PasswordInput
                  id="password"
                  name="password"
                  required
                  autoFocus
                  autoComplete="current-password"
                />
                <p className="text-xs text-muted-foreground">
                  First time signing in? Enter your School ID. You&apos;ll choose your own password next.
                </p>
              </div>
              <Button
                type="submit"
                className="w-full"
                loading={pending}
                loadingText="Signing in…"
              >
                Sign in
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
                <Button
                  type="submit"
                  className="w-full"
                  loading={pending}
                  loadingText="Signing in…"
                >
                  Sign in
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
                <Button
                  type="submit"
                  className="w-full"
                  loading={pending}
                  loadingText="Sending…"
                >
                  Send verification code
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
                  disabled={code.length !== 6}
                  loading={pending}
                  loadingText="Creating account…"
                >
                  Create account
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0 disabled:no-underline"
                    disabled={pending || resendSeconds > 0}
                    onClick={handleResendCode}
                  >
                    {resendSeconds > 0
                      ? `Resend code in ${resendSeconds}s`
                      : "Resend code"}
                  </Button>
                  {" · "}
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    disabled={pending}
                    onClick={() => {
                      setTeacherStep("credentials");
                      setCode("");
                    }}
                  >
                    Edit details
                  </Button>
                </p>
              </form>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
