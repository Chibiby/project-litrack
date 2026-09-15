"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { toast } from "sonner";
import { ArrowRight, Building2, Lock, School, ShieldCheck, User, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  AUTH_FIELD,
  AUTH_FOOTER,
  AUTH_LABEL,
  AUTH_LINK,
  AUTH_PRIMARY_BUTTON,
  AUTH_SEGMENT,
  AUTH_SEGMENT_OFF,
  AUTH_SEGMENT_ON,
  AUTH_SEGMENT_ON_INK,
  AUTH_SEGMENTS,
  AUTH_STEP_TURN,
  AuthCard,
} from "@/components/auth/auth-card";
import { cn } from "@/lib/utils";
import { loginSchoolHead, loginTeacher, registerTeacher } from "@/lib/actions/auth";
import {
  beginSchoolHeadLogin,
  beginTeacherLogin,
  finishSchoolHeadLogin,
  finishTeacherLogin,
  reportLoginFailure,
} from "@/lib/actions/login";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatMessage } from "@/lib/errors/codes";
import { loginFailureReasonFor, mapSupabaseAuthError } from "@/lib/errors/supabase";
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
type Role = "teacher" | "school-head";
type TeacherIntent = "login" | "register";

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

/** The icon-led pickers on the first step share the printed field box. */
const PICKER_TRIGGER = cn(AUTH_FIELD, "gap-3");

/** A step's small print under a field. */
const FIELD_NOTE = "text-sm leading-snug text-aral-slate";

export function LoginForm({
  schools,
  loginError,
  notice,
}: {
  schools: SchoolWithStatus[];
  loginError?: string;
  /** A page-level problem (the school list failed to load), shown in the card. */
  notice?: string;
}) {
  const [screen, setScreen] = useState<Screen>("select-role");
  const [role, setRole] = useState<Role>("teacher");
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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  /** Sync lock so double Enter/click cannot start two registrations before `pending` re-renders. */
  const registerLock = useRef(false);

  useEffect(() => {
    if (loginError) toast.error(loginError);
  }, [loginError]);

  const handleSchoolChange = (value: string) => {
    setSchoolId(value);
    const selected = schools.find((s) => s.id === value);
    const open = selected?.teachersOpen ?? false;
    setTeachersOpen(open);
    // Teachers cannot sign in to a school that has not opened to them yet, so
    // the picked role moves to the one that can continue.
    if (selected && !open) setRole("school-head");
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
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setFirstName("");
    setMiddleName("");
    setLastName("");
  };

  const goBackToSchoolSelect = () => {
    resetTeacherFlow();
    setScreen("select-role");
  };

  const switchTeacherIntent = (intent: TeacherIntent) => {
    setTeacherIntent(intent);
    setPassword("");
    setConfirmPassword("");
  };

  const buildRegisterFormData = () => {
    const formData = new FormData();
    formData.set("schoolId", schoolId);
    formData.set("email", email.trim());
    formData.set("firstName", firstName.trim());
    formData.set("middleName", middleName.trim());
    formData.set("lastName", lastName.trim());
    formData.set("password", password);
    formData.set("confirmPassword", confirmPassword);
    return formData;
  };

  /**
   * Send the person into the app once a session exists.
   *
   * The navigation is a `router.push`, not a server `redirect`, because the
   * session cookies were written by the browser Supabase client — the next
   * request has to be made by that same browser, after those cookies land.
   */
  const enterApp = (redirectTo: string) => {
    markPostLoginSplash();
    resetSidebarExpandedPreference();
    router.push(redirectTo);
    router.refresh();
  };

  const handleTeacherLogin = () => {
    startTransition(async () => {
      const begin = await beginTeacherLogin(schoolId, email);
      if (!begin.ok) {
        toast.error(begin.error);
        return;
      }
      // `beginTeacherLogin` never asks for the server fallback — the teacher
      // supplied the address themselves — but the union allows it, so handle it.
      if (begin.mode === "server") {
        await serverSideTeacherLogin();
        return;
      }

      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: begin.email,
        password,
      });
      if (error) {
        // The browser made this request, so it is the only place that can tell
        // "the server said no" from "the request never arrived". Calling a
        // dropped connection a wrong password is what sends people off to reset
        // a password that was never the problem.
        const code = mapSupabaseAuthError(error, "browser");
        await reportLoginFailure({
          schoolId,
          role: "TEACHER",
          email: begin.email,
          reason: loginFailureReasonFor(code),
        });
        toast.error(formatMessage(code));
        return;
      }

      const finish = await finishTeacherLogin(schoolId);
      if (!finish.ok) {
        toast.error(finish.error);
        return;
      }
      enterApp(finish.redirectTo);
    });
  };

  /** Original server-side grant, kept as the fallback path. */
  const serverSideTeacherLogin = async () => {
    const formData = new FormData();
    formData.set("schoolId", schoolId);
    formData.set("email", email.trim());
    formData.set("password", password);
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
      }
      throw err;
    }
  };

  const handleRegisterTeacher = () => {
    if (pending || registerLock.current) return;

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    const strength = strongPassword.safeParse(password);
    if (!strength.success) {
      toast.error(strength.error.errors[0]?.message ?? PASSWORD_HINT);
      return;
    }

    registerLock.current = true;
    startTransition(async () => {
      try {
        const res = await registerTeacher(buildRegisterFormData());
        if (!res.ok) {
          toast.error(res.error);
          registerLock.current = false;
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
        console.error("[login-form] teacher register failed:", err);
        registerLock.current = false;
        toast.error(formatMessage("INTERNAL_ERROR"));
      }
    });
  };

  /**
   * School Head sign-in.
   *
   * The password grant is made by the browser rather than by the server action,
   * so Supabase's per-IP rate limit meters each person separately instead of
   * pooling every school in the deployment behind one Vercel egress address —
   * see `@/lib/actions/login` for the full reasoning. Heads whose account uses a
   * real email address (rather than the synthetic `sh@…` one) still go through
   * the server action: the server will not hand a personal address to an
   * unauthenticated page.
   */
  const handleSchoolHeadSubmit = (formData: FormData) => {
    const typedPassword = String(formData.get("password") ?? "");
    formData.set("schoolId", schoolId);

    startTransition(async () => {
      const begin = await beginSchoolHeadLogin(schoolId);
      if (!begin.ok) {
        toast.error(begin.error);
        return;
      }
      if (begin.mode === "server") {
        await serverSideSchoolHeadLogin(formData);
        return;
      }

      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: begin.email,
        password: typedPassword,
      });
      if (error) {
        const code = mapSupabaseAuthError(error, "browser");
        await reportLoginFailure({
          schoolId,
          role: "SCHOOL_HEAD",
          reason: loginFailureReasonFor(code),
        });
        toast.error(formatMessage(code));
        return;
      }

      const finish = await finishSchoolHeadLogin(schoolId);
      if (!finish.ok) {
        toast.error(finish.error);
        return;
      }
      enterApp(finish.redirectTo);
    });
  };

  /** Original server-side grant, kept for accounts with a real email address. */
  const serverSideSchoolHeadLogin = async (formData: FormData) => {
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
      }
      throw err;
    }
  };

  if (screen === "select-role") {
    const teachersLocked = Boolean(schoolId) && !teachersOpen;
    const canContinue = Boolean(schoolId) && !(role === "teacher" && teachersLocked);
    const handleContinue = () => {
      if (!canContinue) return;
      if (role === "teacher") {
        resetTeacherFlow();
        setScreen("teacher");
      } else {
        setScreen("school-head");
      }
    };

    return (
      <AuthCard title="Sign in" step={1}>
        <div className={cn("space-y-5", AUTH_STEP_TURN)}>
          {notice ? (
            <p className="rounded-2xl border-2 border-aral-navy bg-aral-wash px-4 py-3 text-sm font-semibold text-aral-navy">
              {notice}
            </p>
          ) : null}
          {districts.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="login-district" className={AUTH_LABEL}>
                District
              </Label>
              <Select value={district} onValueChange={handleDistrictChange}>
                {/* The icon sits beside the value, not wrapped with it: the
                    trigger line-clamps its span children, which stacks them. */}
                <SelectTrigger id="login-district" className={PICKER_TRIGGER}>
                  <Building2 className="size-5 shrink-0 text-aral-slate" aria-hidden />
                  <span className="min-w-0 flex-1 text-left">
                    <SelectValue />
                  </span>
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
          <div className="space-y-1.5">
            <Label htmlFor="login-school" className={AUTH_LABEL}>
              School Name
            </Label>
            {schools.length === 0 ? (
              <p className="rounded-2xl border-2 border-dashed border-aral-edge px-4 py-3 text-sm text-aral-slate">
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
                leadingIcon={<School className="size-5 shrink-0 text-aral-slate" aria-hidden />}
                triggerClassName={PICKER_TRIGGER}
                chevron="down"
              />
            )}
          </div>

          <div className="space-y-1.5">
            <p id="login-role-label" className={AUTH_LABEL}>
              Sign in as
            </p>
            <div role="group" aria-labelledby="login-role-label" className={AUTH_SEGMENTS}>
              <Button
                type="button"
                variant="ghost"
                aria-pressed={role === "teacher"}
                disabled={teachersLocked}
                title={teachersLocked ? TEACHERS_UNLOCK_HELP : undefined}
                onClick={() => setRole("teacher")}
                className={cn(AUTH_SEGMENT, role === "teacher" ? AUTH_SEGMENT_ON : AUTH_SEGMENT_OFF)}
              >
                <User aria-hidden />
                Teachers
              </Button>
              <Button
                type="button"
                variant="ghost"
                aria-pressed={role === "school-head"}
                onClick={() => setRole("school-head")}
                className={cn(
                  AUTH_SEGMENT,
                  role === "school-head" ? AUTH_SEGMENT_ON : AUTH_SEGMENT_OFF
                )}
              >
                <Users aria-hidden />
                School Head
              </Button>
            </div>
            {teachersLocked ? (
              <p className={cn(FIELD_NOTE, "flex items-start gap-2 pt-1")}>
                <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
                {TEACHERS_UNLOCK_HELP}
              </p>
            ) : null}
          </div>

          <Button
            type="button"
            disabled={!canContinue}
            title={!schoolId ? "Select a school first" : undefined}
            onClick={handleContinue}
            className={AUTH_PRIMARY_BUTTON}
          >
            Continue
            <ArrowRight aria-hidden />
          </Button>
        </div>

        <div className={AUTH_FOOTER}>
          <Link href="/forgot-password" className={AUTH_LINK}>
            Forgot password?
          </Link>
          <Link
            href="/admin/login"
            className="inline-flex items-center gap-1.5 font-semibold text-aral-slate underline-offset-4 hover:text-aral-navy hover:underline"
          >
            <ShieldCheck className="size-4" aria-hidden />
            Super Admin sign-in
          </Link>
        </div>
      </AuthCard>
    );
  }

  const schoolName = schools.find((s) => s.id === schoolId)?.name;
  const title =
    screen === "school-head"
      ? "School Head sign in"
      : teacherIntent === "login"
        ? "Teacher sign in"
        : "Create teacher account";

  return (
    <AuthCard title={title} step={2}>
      <div key={screen} className={cn("space-y-5", AUTH_STEP_TURN)}>
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-aral-wash px-3.5 py-2.5">
          <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-aral-navy">
            <School className="size-4 shrink-0 text-aral-slate" aria-hidden />
            <span className="truncate">{schoolName ?? "Your school"}</span>
          </p>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="h-auto shrink-0 p-0 text-sm font-semibold text-aral-blue sm:h-auto"
            onClick={goBackToSchoolSelect}
          >
            Change school
          </Button>
        </div>

        {screen === "school-head" ? (
          <form action={handleSchoolHeadSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="password" className={AUTH_LABEL}>
                School ID or password
              </Label>
              <PasswordInput
                id="password"
                name="password"
                required
                autoFocus
                autoComplete="current-password"
                className={AUTH_FIELD}
              />
              <p className={FIELD_NOTE}>
                First time signing in? Enter your School ID. You&apos;ll choose your own password next.
              </p>
            </div>
            <Button
              type="submit"
              className={AUTH_PRIMARY_BUTTON}
              loading={pending}
              loadingText="Signing in…"
            >
              Sign in
              <ArrowRight aria-hidden />
            </Button>
          </form>
        ) : (
          <div className="space-y-5">
            <div className={AUTH_SEGMENTS}>
              <Button
                type="button"
                variant="ghost"
                aria-pressed={teacherIntent === "login"}
                className={cn(
                  AUTH_SEGMENT,
                  teacherIntent === "login" ? AUTH_SEGMENT_ON_INK : AUTH_SEGMENT_OFF
                )}
                disabled={pending}
                onClick={() => switchTeacherIntent("login")}
              >
                Have an account
              </Button>
              <Button
                type="button"
                variant="ghost"
                aria-pressed={teacherIntent === "register"}
                className={cn(
                  AUTH_SEGMENT,
                  teacherIntent === "register" ? AUTH_SEGMENT_ON_INK : AUTH_SEGMENT_OFF
                )}
                disabled={pending}
                onClick={() => switchTeacherIntent("register")}
              >
                Create account
              </Button>
            </div>
            {teacherIntent === "register" ? (
              <p className={FIELD_NOTE}>
                Set your password now — no verification code needed. Your School Head approves the
                account before you can sign in.
              </p>
            ) : null}

            {teacherIntent === "login" ? (
              <form
                className="space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleTeacherLogin();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="email" className={AUTH_LABEL}>
                    Email
                  </Label>
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
                    className={AUTH_FIELD}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="teacherPassword" className={AUTH_LABEL}>
                    Password
                  </Label>
                  <PasswordInput
                    id="teacherPassword"
                    name="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={pending}
                    className={AUTH_FIELD}
                  />
                </div>
                <Button
                  type="submit"
                  className={AUTH_PRIMARY_BUTTON}
                  loading={pending}
                  loadingText="Signing in…"
                >
                  Sign in
                  <ArrowRight aria-hidden />
                </Button>
              </form>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleRegisterTeacher();
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="firstName" className={AUTH_LABEL}>
                      First name
                    </Label>
                    <Input
                      id="firstName"
                      name="firstName"
                      required
                      autoFocus
                      autoComplete="given-name"
                      autoCapitalize="words"
                      maxLength={100}
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      disabled={pending}
                      className={AUTH_FIELD}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="middleName" className={AUTH_LABEL}>
                      Middle name (optional)
                    </Label>
                    <Input
                      id="middleName"
                      name="middleName"
                      autoComplete="additional-name"
                      autoCapitalize="words"
                      maxLength={100}
                      value={middleName}
                      onChange={(e) => setMiddleName(e.target.value)}
                      disabled={pending}
                      className={AUTH_FIELD}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName" className={AUTH_LABEL}>
                    Last name
                  </Label>
                  <Input
                    id="lastName"
                    name="lastName"
                    required
                    autoComplete="family-name"
                    autoCapitalize="words"
                    maxLength={100}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    disabled={pending}
                    className={AUTH_FIELD}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="registerEmail" className={AUTH_LABEL}>
                    Email
                  </Label>
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
                    className={AUTH_FIELD}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="registerPassword" className={AUTH_LABEL}>
                    Password
                  </Label>
                  <PasswordInput
                    id="registerPassword"
                    name="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={pending}
                    className={AUTH_FIELD}
                  />
                  <p className={FIELD_NOTE}>{PASSWORD_HINT}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword" className={AUTH_LABEL}>
                    Confirm password
                  </Label>
                  <PasswordInput
                    id="confirmPassword"
                    name="confirmPassword"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={pending}
                    className={AUTH_FIELD}
                  />
                </div>
                <Button
                  type="submit"
                  className={cn(AUTH_PRIMARY_BUTTON, "mt-1")}
                  loading={pending}
                  loadingText="Creating account…"
                >
                  Create account
                  <ArrowRight aria-hidden />
                </Button>
              </form>
            )}
          </div>
        )}
      </div>

      {screen === "school-head" || teacherIntent === "login" ? (
        <div className={AUTH_FOOTER}>
          <Link href="/forgot-password" className={AUTH_LINK}>
            Forgot password?
          </Link>
        </div>
      ) : null}
    </AuthCard>
  );
}
