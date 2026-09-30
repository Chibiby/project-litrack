"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { toast } from "sonner";
import {
  ArrowRight,
  BookOpen,
  Building2,
  School,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  AUTH_LABEL,
  AUTH_LINK,
  AUTH_PILL,
  AUTH_PRIMARY_BUTTON,
  AuthCard,
  AuthCardHeader,
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
import { callAction } from "@/lib/ui/call-action";
import type { ActionFailure } from "@/lib/errors/result";
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

/**
 * Runs a server-side sign-in. A successful one redirects, which rejects the
 * client promise after the router has already navigated, so the splash flag is
 * set on that path before the redirect is passed on.
 */
async function markSplashOnRedirect<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isRedirectError(err)) {
      markPostLoginSplash();
      resetSidebarExpandedPreference();
    }
    throw err;
  }
}

type FieldKey = "email" | "password" | "confirmPassword";
type FieldErrors = Partial<Record<FieldKey, string>>;
const FIELD_ORDER: FieldKey[] = ["email", "password", "confirmPassword"];

const ERROR_TEXT = "text-sm font-medium text-destructive";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className={ERROR_TEXT}>
      {message}
    </p>
  );
}

/** The Teachers / School Head toggle: the violet pill when picked, outlined when not. */
const ROLE_OPTION =
  "h-12 w-full rounded-xl text-base font-medium 2xl:h-14 [&_svg]:size-5";
const ROLE_PICKED = cn("border-transparent hover:text-white", AUTH_PILL);
const ROLE_UNPICKED =
  "border-slate-200 bg-card text-indigo-950 hover:border-violet-200 hover:bg-violet-50 hover:text-indigo-950";

/** The tall, icon-led trigger both pickers share on the first step. */
const PICKER_TRIGGER =
  "h-12 gap-3 rounded-xl border-slate-200 bg-card px-4 text-base text-indigo-950 md:text-base 2xl:h-14";

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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  /** Input to focus once the failed attempt has finished and inputs are enabled again. */
  const focusRequest = useRef<string | null>(null);

  useEffect(() => {
    if (loginError) toast.error(loginError);
  }, [loginError]);

  useEffect(() => {
    if (pending || !focusRequest.current) return;
    document.getElementById(focusRequest.current)?.focus();
    focusRequest.current = null;
  }, [pending, fieldErrors, formError]);

  const fieldDomId = (key: FieldKey): string => {
    if (screen === "school-head") return "password";
    if (teacherIntent === "login") return key === "email" ? "email" : "teacherPassword";
    if (key === "email") return "registerEmail";
    return key === "password" ? "registerPassword" : "confirmPassword";
  };

  const clearErrors = () => {
    setFieldErrors({});
    setFormError(null);
  };

  const clearFieldError = (key: FieldKey) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  /** Put a failure next to the input it is about; anything else goes above the submit button. */
  const showFailure = (failure: Pick<ActionFailure, "code" | "error" | "fieldErrors">) => {
    const fromServer = failure.fieldErrors ?? {};
    const next: FieldErrors = {};
    if (fromServer.email) next.email = fromServer.email;
    if (fromServer.password) next.password = fromServer.password;
    if (fromServer.confirmPassword) next.confirmPassword = fromServer.confirmPassword;
    if (Object.keys(next).length === 0) {
      if (failure.code === "AUTH_TEACHER_NOT_FOUND") next.email = failure.error;
      if (failure.code === "AUTH_INCORRECT_PASSWORD") next.password = failure.error;
    }
    const first = FIELD_ORDER.find((key) => next[key]);
    if (first) {
      setFieldErrors(next);
      setFormError(null);
      focusRequest.current = fieldDomId(first);
    } else {
      setFieldErrors({});
      setFormError(Object.values(fromServer)[0] ?? failure.error);
    }
  };

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
    clearErrors();
    setScreen("select-role");
  };

  const switchTeacherIntent = (intent: TeacherIntent) => {
    clearErrors();
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
    clearErrors();
    startTransition(async () => {
      const begin = await callAction(() => beginTeacherLogin(schoolId, email));
      if (!begin.ok) {
        showFailure(begin);
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
        showBrowserGrantFailure(error, { role: "TEACHER", email: begin.email });
        return;
      }

      const finish = await callAction(() => finishTeacherLogin(schoolId));
      if (!finish.ok) {
        showFailure(finish);
        return;
      }
      enterApp(finish.redirectTo);
    });
  };

  /**
   * Show the message first, then tell the server. Awaiting the report before
   * the message meant nothing appeared while offline, and a slow or failed
   * report would hold the message back.
   */
  const showBrowserGrantFailure = (
    error: unknown,
    report: { role: "TEACHER" | "SCHOOL_HEAD"; email?: string }
  ) => {
    // Offline is not a sign-in attempt worth auditing, and the report could not be sent anyway.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      showFailure({ code: "NETWORK_OFFLINE", error: formatMessage("NETWORK_OFFLINE") });
      return;
    }
    const code = mapSupabaseAuthError(error, "browser");
    showFailure({ code, error: formatMessage(code) });
    void callAction(() =>
      reportLoginFailure({ schoolId, ...report, reason: loginFailureReasonFor(code) })
    );
  };

  /** Original server-side grant, kept as the fallback path. */
  const serverSideTeacherLogin = async () => {
    const formData = new FormData();
    formData.set("schoolId", schoolId);
    formData.set("email", email.trim());
    formData.set("password", password);
    const res = await markSplashOnRedirect(() => callAction(() => loginTeacher(formData)));
    if (res && !res.ok) {
      showFailure(res);
      return;
    }
    markPostLoginSplash();
    resetSidebarExpandedPreference();
  };

  const handleRegisterTeacher = () => {
    if (pending || registerLock.current) return;
    clearErrors();

    if (password !== confirmPassword) {
      setFieldErrors({ confirmPassword: "Passwords do not match" });
      focusRequest.current = "confirmPassword";
      return;
    }

    const strength = strongPassword.safeParse(password);
    if (!strength.success) {
      setFieldErrors({ password: strength.error.errors[0]?.message ?? PASSWORD_HINT });
      focusRequest.current = "registerPassword";
      return;
    }

    registerLock.current = true;
    startTransition(async () => {
      const res = await callAction(() => registerTeacher(buildRegisterFormData()));
      if (!res.ok) {
        registerLock.current = false;
        showFailure(res);
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
  const handleSchoolHeadSubmit = () => {
    const typedPassword = password;
    const formData = new FormData();
    formData.set("schoolId", schoolId);
    formData.set("password", typedPassword);
    clearErrors();

    startTransition(async () => {
      const begin = await callAction(() => beginSchoolHeadLogin(schoolId));
      if (!begin.ok) {
        showFailure(begin);
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
        showBrowserGrantFailure(error, { role: "SCHOOL_HEAD" });
        return;
      }

      const finish = await callAction(() => finishSchoolHeadLogin(schoolId));
      if (!finish.ok) {
        showFailure(finish);
        return;
      }
      enterApp(finish.redirectTo);
    });
  };

  /** Original server-side grant, kept for accounts with a real email address. */
  const serverSideSchoolHeadLogin = async (formData: FormData) => {
    const res = await markSplashOnRedirect(() => callAction(() => loginSchoolHead(formData)));
    if (res && !res.ok) {
      showFailure(res);
      return;
    }
    markPostLoginSplash();
    resetSidebarExpandedPreference();
  };

  if (screen === "select-role") {
    const teachersLocked = Boolean(schoolId) && !teachersOpen;
    const canContinue = Boolean(schoolId) && !(role === "teacher" && teachersLocked);
    const handleContinue = () => {
      if (!canContinue) return;
      clearErrors();
      resetTeacherFlow();
      setScreen(role === "teacher" ? "teacher" : "school-head");
    };
    const continueHint =
      !schoolId && schools.length > 0 ? "Select your school to continue." : null;

    return (
      <AuthCard>
        <AuthCardHeader icon={BookOpen} title="Sign In" subtitle="Access your LITRACK account" />
        <div className="mt-6 2xl:mt-8">
          {notice ? (
            <p className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center text-sm text-amber-900 2xl:mb-6">
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
                  <Building2 className="size-5 shrink-0 text-slate-500" aria-hidden />
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
          <div className={cn("space-y-1.5", districts.length > 0 && "mt-3")}>
            <Label htmlFor="login-school" className={AUTH_LABEL}>
              School Name
            </Label>
            {schools.length === 0 ? (
              // The notice above already says the list failed to load; "No schools
              // found" would contradict it.
              notice ? null : (
                <p className="rounded-xl border border-slate-200 bg-muted/60 p-4 text-center text-sm text-slate-600">
                  No schools found. Contact admin.
                </p>
              )
            ) : (
              <SearchableSelect
                id="login-school"
                options={schoolOptions}
                value={schoolId}
                onValueChange={handleSchoolChange}
                placeholder="Select your school"
                searchPlaceholder="Search schools…"
                emptyMessage="No schools match your search."
                leadingIcon={<School className="size-5 shrink-0 text-slate-500" aria-hidden />}
                triggerClassName={PICKER_TRIGGER}
                chevron="down"
              />
            )}
          </div>

          <div className="mt-6 space-y-2 2xl:mt-7">
            <div role="group" aria-label="Sign in as" className="grid grid-cols-2 gap-3">
              <Button
                type="button"
                variant="outline"
                aria-pressed={role === "teacher"}
                disabled={teachersLocked}
                title={teachersLocked ? TEACHERS_UNLOCK_HELP : undefined}
                onClick={() => setRole("teacher")}
                className={cn(ROLE_OPTION, role === "teacher" ? ROLE_PICKED : ROLE_UNPICKED)}
              >
                <User aria-hidden />
                Teachers
              </Button>
              <Button
                type="button"
                variant="outline"
                aria-pressed={role === "school-head"}
                onClick={() => setRole("school-head")}
                className={cn(ROLE_OPTION, role === "school-head" ? ROLE_PICKED : ROLE_UNPICKED)}
              >
                <Users aria-hidden />
                School Head
              </Button>
            </div>
            {teachersLocked ? (
              <p className="text-sm text-slate-600">{TEACHERS_UNLOCK_HELP}</p>
            ) : null}
          </div>

          <Button
            type="button"
            disabled={!canContinue}
            aria-describedby={continueHint ? "login-continue-hint" : undefined}
            onClick={handleContinue}
            className={cn(AUTH_PRIMARY_BUTTON, "mt-6 2xl:mt-7")}
          >
            <ArrowRight aria-hidden />
            {role === "teacher" ? "Next: enter email and password" : "Next: enter password"}
          </Button>
          {continueHint ? (
            <p id="login-continue-hint" className="mt-2 text-center text-sm text-slate-600">
              {continueHint}
            </p>
          ) : null}

          <div className="mt-6 flex items-center gap-3 text-sm text-slate-500 2xl:mt-7" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            or
            <span className="h-px flex-1 bg-border" />
          </div>

          <p className="mt-4 text-center">
            <Link
              href="/forgot-password"
              className={cn("text-sm", AUTH_LINK)}
            >
              Forgot password?
            </Link>
          </p>

          <Button
            asChild
            variant="outline"
            className="mt-3 h-11 w-full rounded-xl border-violet-100 bg-violet-50 text-sm font-medium text-indigo-950 hover:bg-violet-100 hover:text-indigo-950 lg:h-10 2xl:h-11 2xl:text-base [&_svg]:size-4 [&_svg]:text-violet-600"
          >
            <Link href="/admin/login">
              <ShieldCheck aria-hidden />
              Admin Login
            </Link>
          </Button>
        </div>
      </AuthCard>
    );
  }

  const schoolName = schools.find((s) => s.id === schoolId)?.name;

  return (
    <AuthCard>
      <div className="space-y-4">
        <Button
          type="button"
          variant="link"
          size="sm"
          className="mb-1 h-auto min-h-11 p-0 text-sm text-slate-600 hover:text-indigo-950"
          onClick={goBackToSchoolSelect}
        >
          ← Change school
        </Button>
        {schoolName ? (
          <p className="flex items-center gap-2 text-sm font-medium text-slate-600">
            <School className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{schoolName}</span>
          </p>
        ) : null}

        {screen === "school-head" ? (
          <>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                handleSchoolHeadSubmit();
              }}
            >
              <h2 className="text-2xl font-bold tracking-tight text-indigo-950">
                School Head sign in
              </h2>
              <div className="space-y-2">
                <Label htmlFor="password">School ID or password</Label>
                <PasswordInput
                  id="password"
                  name="password"
                  required
                  autoFocus
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearFieldError("password");
                  }}
                  aria-invalid={fieldErrors.password ? true : undefined}
                  aria-describedby={fieldErrors.password ? "password-error" : undefined}
                />
                <FieldError id="password-error" message={fieldErrors.password} />
                <p className="text-xs text-muted-foreground">
                  First time signing in? Enter your School ID. You&apos;ll choose your own password next.
                </p>
              </div>
              <FieldError id="login-form-error" message={formError ?? undefined} />
              <Button
                type="submit"
                className={AUTH_PRIMARY_BUTTON}
                loading={pending}
                loadingText="Signing in…"
              >
                Sign in
              </Button>
            </form>
            <p className="text-center">
              <Link href="/forgot-password" className={cn("text-sm", AUTH_LINK)}>
                Forgot password?
              </Link>
            </p>
          </>
        ) : (
          <div className="space-y-4">
            <h2 className="text-2xl font-bold tracking-tight text-indigo-950">
              {teacherIntent === "login" ? "Teacher sign in" : "Create teacher account"}
            </h2>
            {teacherIntent === "register" ? (
              <p className="text-xs text-muted-foreground">
                Set your password now — no verification code needed. Your School Head approves the
                account before you can sign in.
              </p>
            ) : null}

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
                    onChange={(e) => {
                      setEmail(e.target.value);
                      clearFieldError("email");
                    }}
                    disabled={pending}
                    placeholder="you@school.edu"
                    aria-invalid={fieldErrors.email ? true : undefined}
                    aria-describedby={fieldErrors.email ? "email-error" : undefined}
                  />
                  <FieldError id="email-error" message={fieldErrors.email} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="teacherPassword">Password</Label>
                  <PasswordInput
                    id="teacherPassword"
                    name="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      clearFieldError("password");
                    }}
                    disabled={pending}
                    aria-invalid={fieldErrors.password ? true : undefined}
                    aria-describedby={fieldErrors.password ? "teacherPassword-error" : undefined}
                  />
                  <FieldError id="teacherPassword-error" message={fieldErrors.password} />
                </div>
                <FieldError id="login-form-error" message={formError ?? undefined} />
                <Button
                  type="submit"
                  className={AUTH_PRIMARY_BUTTON}
                  loading={pending}
                  loadingText="Signing in…"
                >
                  Sign in
                </Button>
                <p className="text-center">
                  <Link href="/forgot-password" className={cn("text-sm", AUTH_LINK)}>
                    Forgot password?
                  </Link>
                </p>
              </form>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleRegisterTeacher();
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
                    autoCapitalize="words"
                    maxLength={100}
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
                    autoCapitalize="words"
                    maxLength={100}
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
                    autoCapitalize="words"
                    maxLength={100}
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
                    onChange={(e) => {
                      setEmail(e.target.value);
                      clearFieldError("email");
                    }}
                    disabled={pending}
                    placeholder="you@school.edu"
                    aria-invalid={fieldErrors.email ? true : undefined}
                    aria-describedby={fieldErrors.email ? "registerEmail-error" : undefined}
                  />
                  <FieldError id="registerEmail-error" message={fieldErrors.email} />
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
                    onChange={(e) => {
                      setPassword(e.target.value);
                      clearFieldError("password");
                    }}
                    disabled={pending}
                    aria-invalid={fieldErrors.password ? true : undefined}
                    aria-describedby={
                      fieldErrors.password ? "registerPassword-error" : "registerPassword-hint"
                    }
                  />
                  <FieldError id="registerPassword-error" message={fieldErrors.password} />
                  <p id="registerPassword-hint" className="text-xs text-muted-foreground">
                    {PASSWORD_HINT}
                  </p>
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
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      clearFieldError("confirmPassword");
                    }}
                    disabled={pending}
                    aria-invalid={fieldErrors.confirmPassword ? true : undefined}
                    aria-describedby={
                      fieldErrors.confirmPassword ? "confirmPassword-error" : undefined
                    }
                  />
                  <FieldError id="confirmPassword-error" message={fieldErrors.confirmPassword} />
                </div>
                <FieldError id="login-form-error" message={formError ?? undefined} />
                <Button
                  type="submit"
                  className={AUTH_PRIMARY_BUTTON}
                  loading={pending}
                  loadingText="Creating account…"
                >
                  Create account
                </Button>
              </form>
            )}
          </div>
        )}
      </div>
    </AuthCard>
  );
}
