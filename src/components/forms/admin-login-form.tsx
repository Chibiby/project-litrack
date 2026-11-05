"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { LockKeyhole, School, UserRound } from "lucide-react";
import { callAction } from "@/lib/ui/call-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { AppForm, applyFieldErrors, useAppForm } from "@/components/forms/app-form";
import { adminLoginSchema, type AdminLoginInput } from "@/lib/validators/auth.schema";
import { loginAdmin } from "@/lib/actions/auth";
import { resetSidebarExpandedPreference } from "@/hooks/use-sidebar-expanded";
import { toFormData } from "@/lib/forms/to-form-data";
import { POST_LOGIN_FLAG } from "@/lib/post-login-flag";
import {
  AUTH_LINK,
  AUTH_PRIMARY_BUTTON,
  AuthCard,
  AuthCardHeader,
  FIELD_ICON,
  FLOAT_INPUT,
  FLOAT_LABEL,
} from "@/components/auth/auth-card";
import { cn } from "@/lib/utils";
import { useShakeInvalid } from "@/hooks/use-shake-invalid";

const SHARED_ERROR_ID = "admin-login-error";

/** Mark next app shell paint to show the post-login splash (survives redirect). */
function markPostLoginSplash() {
  try {
    sessionStorage.setItem(POST_LOGIN_FLAG, "1");
  } catch {
    // sessionStorage unavailable — splash simply won't show
  }
}

export function AdminLoginForm({
  disabled = false,
  notice,
}: {
  disabled?: boolean;
  /** Session-ended or configuration notes, shown under the card's title. */
  notice?: React.ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const [sharedError, setSharedError] = useState<string | null>(null);
  const form = useAppForm<AdminLoginInput>({
    schema: adminLoginSchema,
    defaultValues: { username: "", password: "" },
    // Check only when Sign in is pressed: leaving an empty field, or typing,
    // never raises a warning on its own (operator, 2026-11-06).
    mode: "onSubmit",
    reValidateMode: "onSubmit",
  });
  const { errors } = form.formState;
  const sharedShown = sharedError && (errors.username?.type === "server" || errors.password?.type === "server")
    ? sharedError
    : null;
  const sharedProps = sharedShown ? { "aria-describedby": SHARED_ERROR_ID } : {};
  const { ref: fieldsRef, shake } = useShakeInvalid();

  /**
   * Editing a field takes its warning away (it is being fixed) without raising
   * a new one; a shared "incorrect username or password" goes from both.
   */
  const clearOnEdit =
    (name: keyof AdminLoginInput, onChange: (e: React.ChangeEvent<HTMLInputElement>) => void) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(e);
      if (sharedError) {
        setSharedError(null);
        form.clearErrors(["username", "password"]);
      } else if (form.formState.errors[name]) {
        form.clearErrors(name);
      }
    };

  return (
    <AuthCard className="pt-10 sm:pt-12 2xl:pt-16">
      <AuthCardHeader title="Sign In" subtitle="Sign in as Division or District Admin" />
      <div ref={fieldsRef} className="mt-6 space-y-5 2xl:mt-8">
        {notice}
        <AppForm
          form={form}
          className="space-y-5"
          onInvalid={shake}
          onSubmit={(values) => {
            setFormError(null);
            startTransition(async () => {
              let res;
              try {
                res = await callAction(() => loginAdmin(toFormData(values)));
              } catch (err) {
                if (isRedirectError(err)) {
                  markPostLoginSplash();
                  resetSidebarExpandedPreference();
                }
                throw err;
              }
              if (res && !res.ok) {
                if (res.code === "AUTH_INCORRECT_CREDENTIALS") {
                  // One sentence for both inputs, so nothing says which half was wrong.
                  setSharedError(res.error);
                  form.setError("username", { type: "server" }, { shouldFocus: true });
                  form.setError("password", { type: "server" });
                  shake();
                  return;
                }
                if (applyFieldErrors(form, res)) shake();
                else setFormError(res.error);
                return;
              }
              markPostLoginSplash();
              resetSidebarExpandedPreference();
            });
          }}
        >
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <div className="group relative" data-shake data-filled={field.value !== ""}>
                <UserRound className={FIELD_ICON} aria-hidden />
                <FormControl>
                  <Input
                    className={cn(FLOAT_INPUT, "pr-5")}
                    type="text"
                    autoComplete="username"
                    // The handle is stored lower-case and the schema folds case
                    // anyway; switching these off just stops phone keyboards
                    // from capitalising the first letter as it is typed.
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                    disabled={disabled || pending}
                    {...sharedProps}
                    {...field}
                    onChange={clearOnEdit("username", field.onChange)}
                  />
                </FormControl>
                <FormLabel className={FLOAT_LABEL}>Username</FormLabel>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <div className="group relative" data-shake data-filled={field.value !== ""}>
                <LockKeyhole className={cn(FIELD_ICON, "z-10")} aria-hidden />
                <FormLabel className={cn(FLOAT_LABEL, "z-10")}>Password</FormLabel>
                <FormControl>
                  <PasswordInput
                    className={FLOAT_INPUT}
                    toggleSize="lg"
                    autoComplete="current-password"
                    disabled={disabled || pending}
                    {...sharedProps}
                    {...field}
                    onChange={clearOnEdit("password", field.onChange)}
                  />
                </FormControl>
                </div>
                <FormMessage />
                {sharedShown ? (
                  <p id={SHARED_ERROR_ID} role="alert" className="text-xs font-medium text-destructive">
                    {sharedShown}
                  </p>
                ) : null}
              </FormItem>
            )}
          />
          {formError ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {formError}
            </p>
          ) : null}
          <Button
            type="submit"
            className={AUTH_PRIMARY_BUTTON}
            disabled={disabled}
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
            <Link href="/login" className={cn("inline-flex items-center gap-1", AUTH_LINK)}>
              <School aria-hidden className="size-4" />
              School login
            </Link>
          </p>
          {/* Admin accounts sign in by username and most have no mailbox, so the
              email reset above cannot reach them. */}
          <p className="text-center text-sm text-slate-600">
            No reset email? Ask the division office to reset your password.
          </p>
        </AppForm>
      </div>
    </AuthCard>
  );
}
