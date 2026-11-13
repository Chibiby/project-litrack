"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { toast } from "sonner";
import {
  ArrowRight,
  Building2,
  GraduationCap,
  LockKeyhole,
  Mail,
  School,
  ShieldCheck,
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
  FIELD_ICON,
  FLOAT_INPUT,
  FLOAT_LABEL,
  GLASS_FIELD,
} from "@/components/auth/auth-card";
import { cn } from "@/lib/utils";
import { useShakeInvalid } from "@/hooks/use-shake-invalid";
import { loginSchoolHead, loginTeacher, registerTeacher } from "@/lib/actions/auth";
import { callAction } from "@/lib/ui/call-action";
import type { ActionFailure } from "@/lib/errors/result";
import { resetSidebarExpandedPreference } from "@/hooks/use-sidebar-expanded";
import {
  checkSchoolHeadLogin,
  checkTeacherLogin,
  checkTeacherRegister,
  firstLoginFieldError,
  type LoginFieldErrors,
  type LoginFieldKey,
} from "@/lib/auth/login-field-checks";
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

type FieldKey = LoginFieldKey;
type FieldErrors = LoginFieldErrors;

const ERROR_TEXT = "text-sm font-medium text-destructive";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className={ERROR_TEXT}>
      {message}
    </p>
  );
}

type NavDir = "forward" | "back" | null;

/** Length of the step slide: `duration-slow` below (--motion-slow). */
const STEP_SLIDE_MS = 420;

/**
 * Step change inside the card, like a navigation push and pop: a step reached
 * by going forward (Next, Create account) slides in from the right; one reached
 * by going back (Change school, Sign in) slides in from the left. It travels
 * the card's full width with iOS's push curve (fast start, long settle), so on
 * a phone it reads as a page moving rather than a twitch. Reduce Motion shows
 * the step at once.
 */
function stepSlide(dir: NavDir): string {
  if (!dir) return "";
  return cn(
    // tailwindcss-animate reads the named duration-slow / ease-slide tokens for
    // the animation itself (it ignores arbitrary duration-[…] / ease-[…]).
    "animate-in fade-in-50 duration-slow ease-slide motion-reduce:animate-none",
    dir === "forward" ? "slide-in-from-right-full" : "slide-in-from-left-full",
  );
}

/**
 * Focus a new step's first field (marked data-autofocus) only once its slide has
 * finished, and never on touch screens. Focusing during the slide opened the
 * phone keyboard and made the browser scroll toward a field that was still
 * moving, which shook the whole step; on phones the user taps the field instead.
 */
function focusStepField(step: HTMLElement | null) {
  const field = step?.querySelector<HTMLElement>("[data-autofocus]");
  if (!field || window.matchMedia?.("(pointer: coarse)").matches) return;
  const focus = () => {
    if (field.isConnected) field.focus({ preventScroll: true });
  };
  // A timer, not animationend: a tab in the background never finishes the
  // animation, and the field must still get focus.
  const animated = Boolean(step!.getAnimations?.().length);
  if (animated) window.setTimeout(focus, STEP_SLIDE_MS);
  else focus();
}

/**
 * The Teachers / School Head switch: one track holding both options, the
 * picked one as the violet pill. Track lg (12px) with p-1 (4px) → options
 * md (8px), so the corners stay concentric (docs/design-radius.md).
 */
const ROLE_SWITCH =
  "grid grid-cols-2 gap-1 rounded-lg border border-white/60 bg-card/45 p-1 shadow-highlight-soft";
const ROLE_OPTION =
  "inline-flex h-10 w-full items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-aral-500 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 sm:text-base 2xl:h-12 [&_svg]:size-4 sm:[&_svg]:size-5";
const ROLE_PICKED = AUTH_PILL;
const ROLE_UNPICKED = "text-slate-700 hover:bg-card/45 hover:text-indigo-950";

/** The tall, icon-led trigger both pickers share on the first step. */
const PICKER_TRIGGER = cn(
  GLASS_FIELD,
  "h-12 gap-3 rounded-md px-4 text-sm text-indigo-950 sm:text-base lg:h-12 lg:text-base 2xl:h-14",
);

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
  // Which way the last step change went, so the new step slides in from the
  // matching side (null on first load: nothing slides).
  const [navDir, setNavDir] = useState<NavDir>(null);
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
  /** Shakes the fields an attempt marked invalid (ref sits on the step's content). */
  const { ref: stepRef, shake } = useShakeInvalid();

  useEffect(() => {
    if (loginError) toast.error(loginError);
  }, [loginError]);

  // A new sign-in step focuses its first field after its slide (see focusStepField).
  useEffect(() => {
    focusStepField(stepRef.current);
  }, [screen, teacherIntent, stepRef]);

  useEffect(() => {
    if (pending || !focusRequest.current) return;
    document.getElementById(focusRequest.current)?.focus();
    focusRequest.current = null;
  }, [pending, fieldErrors, formError]);

  const fieldDomId = (key: FieldKey): string => {
    if (key === "firstName" || key === "lastName") return key;
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
    if (fromServer.firstName) next.firstName = fromServer.firstName;
    if (fromServer.lastName) next.lastName = fromServer.lastName;
    if (fromServer.email) next.email = fromServer.email;
    if (fromServer.password) next.password = fromServer.password;
    if (fromServer.confirmPassword) next.confirmPassword = fromServer.confirmPassword;
    if (Object.keys(next).length === 0) {
      if (failure.code === "AUTH_TEACHER_NOT_FOUND") next.email = failure.error;
      if (failure.code === "AUTH_INCORRECT_PASSWORD") next.password = failure.error;
    }
    if (!showFieldErrors(next)) {
      setFieldErrors({});
      setFormError(Object.values(fromServer)[0] ?? failure.error);
    }
  };

  /**
   * Shows field warnings inline (focus the first, shake them all). Returns
   * false when there are none. Used for the checks run when a button is
   * pressed and for field errors the server sends back.
   */
  const showFieldErrors = (errors: FieldErrors): boolean => {
    const first = firstLoginFieldError(errors);
    if (!first) return false;
    setFieldErrors(errors);
    setFormError(null);
    focusRequest.current = fieldDomId(first);
    shake();
    return true;
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
    setNavDir("back");
    setScreen("select-role");
  };

  const switchTeacherIntent = (intent: TeacherIntent) => {
    clearErrors();
    setNavDir(intent === "register" ? "forward" : "back");
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

  const handleTeacherLogin = () => {
    clearErrors();
    if (showFieldErrors(checkTeacherLogin({ email, password }))) return;
    startTransition(async () => {
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
    });
  };

  const handleRegisterTeacher = () => {
    if (pending || registerLock.current) return;
    clearErrors();
    if (
      showFieldErrors(
        checkTeacherRegister({ firstName, lastName, email, password, confirmPassword }),
      )
    ) {
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

  const handleSchoolHeadSubmit = () => {
    const formData = new FormData();
    formData.set("schoolId", schoolId);
    formData.set("password", password);
    clearErrors();
    if (showFieldErrors(checkSchoolHeadLogin({ password }))) return;

    startTransition(async () => {
      const res = await markSplashOnRedirect(() => callAction(() => loginSchoolHead(formData)));
      if (res && !res.ok) {
        showFailure(res);
        return;
      }
      markPostLoginSplash();
      resetSidebarExpandedPreference();
    });
  };

  if (screen === "select-role") {
    const teachersLocked = Boolean(schoolId) && !teachersOpen;
    const canContinue = Boolean(schoolId) && !(role === "teacher" && teachersLocked);
    const handleContinue = () => {
      if (!canContinue) return;
      clearErrors();
      resetTeacherFlow();
      setNavDir("forward");
      setScreen(role === "teacher" ? "teacher" : "school-head");
    };
    const continueHint =
      !schoolId && schools.length > 0 ? "Select your school to continue." : null;

    return (
      <AuthCard className="overflow-hidden pt-10 sm:pt-12 2xl:pt-16">
        <div key="select-role" className={stepSlide(navDir)}>
        <AuthCardHeader title="Sign In" subtitle="Choose your district and school" />
        <div className="mt-4 2xl:mt-5">
          {notice ? (
            <p className="mb-5 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-center text-sm text-warning-900 2xl:mb-6">
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
              School
            </Label>
            {schools.length === 0 ? (
              // The notice above already says the list failed to load; "No schools
              // found" would contradict it.
              notice ? null : (
                <p className="rounded-lg border border-slate-200 bg-muted/60 p-4 text-center text-sm text-slate-600">
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
            <div role="group" aria-label="Sign in as" className={ROLE_SWITCH}>
              <button
                type="button"
                aria-pressed={role === "teacher"}
                disabled={teachersLocked}
                title={teachersLocked ? TEACHERS_UNLOCK_HELP : undefined}
                onClick={() => setRole("teacher")}
                data-press="light"
                className={cn(ROLE_OPTION, role === "teacher" ? ROLE_PICKED : ROLE_UNPICKED)}
              >
                <GraduationCap aria-hidden />
                Teachers
              </button>
              <button
                type="button"
                aria-pressed={role === "school-head"}
                onClick={() => setRole("school-head")}
                data-press="light"
                className={cn(ROLE_OPTION, role === "school-head" ? ROLE_PICKED : ROLE_UNPICKED)}
              >
                <School aria-hidden />
                School Head
              </button>
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
            Next
            <ArrowRight aria-hidden />
          </Button>
          {continueHint ? (
            <p id="login-continue-hint" className="mt-2 text-center text-sm text-slate-600">
              {continueHint}
            </p>
          ) : null}

          <p className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm 2xl:mt-7">
            <Link href="/forgot-password" className={AUTH_LINK}>
              Forgot password?
            </Link>
            <span aria-hidden className="text-slate-400">
              ·
            </span>
            <Link href="/admin/login" className={cn("inline-flex items-center gap-1", AUTH_LINK)}>
              <ShieldCheck aria-hidden className="size-4" />
              Admin Login
            </Link>
          </p>
        </div>
        </div>
      </AuthCard>
    );
  }

  const schoolName = schools.find((s) => s.id === schoolId)?.name;

  // Every step keeps the card's centred title; the line under it says what
  // this step is for.
  const header =
    screen === "school-head"
      ? { title: "Sign In", subtitle: "Sign in as School Head" }
      : teacherIntent === "login"
        ? { title: "Sign In", subtitle: "Sign in to your teacher account" }
        : { title: "Create Account", subtitle: "Create your teacher account" };

  return (
    <AuthCard className="overflow-hidden pt-10 sm:pt-12 2xl:pt-16">
      <div ref={stepRef} key={`${screen}-${teacherIntent}`} className={cn("space-y-4", stepSlide(navDir))}>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="-mt-4 mb-1 h-auto min-h-11 p-0 text-sm text-slate-600 hover:text-indigo-950 sm:-mt-6"
          onClick={goBackToSchoolSelect}
        >
          ← Change school
        </Button>
        <AuthCardHeader title={header.title} subtitle={header.subtitle} />
        {schoolName ? (
          <p className="flex items-center justify-center gap-2 text-sm font-medium text-slate-600">
            <School className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{schoolName}</span>
          </p>
        ) : null}

        {screen === "school-head" ? (
          <>
            <form
              noValidate
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                handleSchoolHeadSubmit();
              }}
            >
              <div className="space-y-2">
                <div className="group relative" data-shake data-filled={password !== ""}>
                  <LockKeyhole className={cn(FIELD_ICON, "z-10")} aria-hidden />
                  <Label htmlFor="password" className={cn(FLOAT_LABEL, "z-10")}>
                    School ID or password
                  </Label>
                <PasswordInput
                  id="password"
                  name="password"
                  className={FLOAT_INPUT}
                  toggleSize="lg"
                  required
                  data-autofocus
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    clearFieldError("password");
                  }}
                  aria-invalid={fieldErrors.password ? true : undefined}
                  aria-describedby={fieldErrors.password ? "password-error" : undefined}
                />
                </div>
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
            {teacherIntent === "register" ? (
              <p className="text-center text-xs text-muted-foreground">
                Set your password now — no verification code needed. Your School Head approves the
                account before you can sign in.
              </p>
            ) : null}

            {teacherIntent === "login" ? (
              <form
                noValidate
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleTeacherLogin();
                }}
              >
                <div className="space-y-2">
                  <div className="group relative" data-shake data-filled={email !== ""}>
                    <Mail className={FIELD_ICON} aria-hidden />
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      className={cn(FLOAT_INPUT, "pr-5")}
                      required
                      data-autofocus
                      autoComplete="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        clearFieldError("email");
                      }}
                      disabled={pending}
                      aria-invalid={fieldErrors.email ? true : undefined}
                      aria-describedby={fieldErrors.email ? "email-error" : undefined}
                    />
                    <Label htmlFor="email" className={FLOAT_LABEL}>
                      Email
                    </Label>
                  </div>
                  <FieldError id="email-error" message={fieldErrors.email} />
                </div>
                <div className="space-y-2">
                  <div className="group relative" data-shake data-filled={password !== ""}>
                    <LockKeyhole className={cn(FIELD_ICON, "z-10")} aria-hidden />
                    <Label htmlFor="teacherPassword" className={cn(FLOAT_LABEL, "z-10")}>
                      Password
                    </Label>
                  <PasswordInput
                    id="teacherPassword"
                    name="password"
                    className={FLOAT_INPUT}
                    toggleSize="lg"
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
                  </div>
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
                <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm">
                  <Link href="/forgot-password" className={AUTH_LINK}>
                    Forgot password?
                  </Link>
                  <span aria-hidden className="text-slate-400">
                    ·
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => switchTeacherIntent("register")}
                    className={cn(AUTH_LINK, "disabled:opacity-50")}
                  >
                    Create account
                  </button>
                </p>
              </form>
            ) : (
              <form
                noValidate
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleRegisterTeacher();
                }}
              >
                <div className="space-y-2" data-shake>
                  <Label htmlFor="firstName">First name</Label>
                  <Input
                    id="firstName"
                    className={GLASS_FIELD}
                    name="firstName"
                    required
                    data-autofocus
                    autoComplete="given-name"
                    autoCapitalize="words"
                    maxLength={100}
                    value={firstName}
                    onChange={(e) => {
                      setFirstName(e.target.value);
                      clearFieldError("firstName");
                    }}
                    disabled={pending}
                    aria-invalid={fieldErrors.firstName ? true : undefined}
                    aria-describedby={fieldErrors.firstName ? "firstName-error" : undefined}
                  />
                  <FieldError id="firstName-error" message={fieldErrors.firstName} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="middleName">Middle name (optional)</Label>
                  <Input
                    id="middleName"
                    className={GLASS_FIELD}
                    name="middleName"
                    autoComplete="additional-name"
                    autoCapitalize="words"
                    maxLength={100}
                    value={middleName}
                    onChange={(e) => setMiddleName(e.target.value)}
                    disabled={pending}
                  />
                </div>
                <div className="space-y-2" data-shake>
                  <Label htmlFor="lastName">Last name</Label>
                  <Input
                    id="lastName"
                    className={GLASS_FIELD}
                    name="lastName"
                    required
                    autoComplete="family-name"
                    autoCapitalize="words"
                    maxLength={100}
                    value={lastName}
                    onChange={(e) => {
                      setLastName(e.target.value);
                      clearFieldError("lastName");
                    }}
                    disabled={pending}
                    aria-invalid={fieldErrors.lastName ? true : undefined}
                    aria-describedby={fieldErrors.lastName ? "lastName-error" : undefined}
                  />
                  <FieldError id="lastName-error" message={fieldErrors.lastName} />
                </div>
                <div className="space-y-2" data-shake>
                  <Label htmlFor="registerEmail">Email</Label>
                  <Input
                    id="registerEmail"
                    className={GLASS_FIELD}
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
                <div className="space-y-2" data-shake>
                  <Label htmlFor="registerPassword">Password</Label>
                  <PasswordInput
                    id="registerPassword"
                    className={GLASS_FIELD}
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
                <div className="space-y-2" data-shake>
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <PasswordInput
                    id="confirmPassword"
                    className={GLASS_FIELD}
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
                <p className="text-center text-sm text-slate-600">
                  Already have an account?{" "}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => switchTeacherIntent("login")}
                    className={cn(AUTH_LINK, "disabled:opacity-50")}
                  >
                    Sign in
                  </button>
                </p>
              </form>
            )}
          </div>
        )}
      </div>
    </AuthCard>
  );
}
