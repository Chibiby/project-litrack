"use client";

import { useTransition } from "react";
import Link from "next/link";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
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
import { AppForm, useAppForm } from "@/components/forms/app-form";
import { adminLoginSchema, type AdminLoginInput } from "@/lib/validators/auth.schema";
import { loginAdmin } from "@/lib/actions/auth";
import { resetSidebarExpandedPreference } from "@/hooks/use-sidebar-expanded";
import { toFormData } from "@/lib/forms/to-form-data";
import { POST_LOGIN_FLAG } from "@/lib/post-login-flag";
import {
  AUTH_FIELD,
  AUTH_FOOTER,
  AUTH_LABEL,
  AUTH_LINK,
  AUTH_PRIMARY_BUTTON,
  AUTH_STEP_TURN,
  AuthCard,
} from "@/components/auth/auth-card";
import { cn } from "@/lib/utils";

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
  const form = useAppForm<AdminLoginInput>({
    schema: adminLoginSchema,
    defaultValues: { username: "", password: "" },
  });

  return (
    <AuthCard title="Super Admin sign-in">
      <div className={cn("space-y-5", AUTH_STEP_TURN)}>
        {notice}
        <AppForm
          form={form}
          className="space-y-5"
          onSubmit={(values) => {
            startTransition(async () => {
              try {
                const res = await loginAdmin(toFormData(values));
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
          }}
        >
          <FormField
            control={form.control}
            name="username"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={AUTH_LABEL}>
                  Username
                </FormLabel>
                <FormControl>
                  <Input
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
                    className={AUTH_FIELD}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel className={AUTH_LABEL}>
                  Password
                </FormLabel>
                <FormControl>
                  <PasswordInput
                    autoComplete="current-password"
                    disabled={disabled || pending}
                    className={AUTH_FIELD}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            className={AUTH_PRIMARY_BUTTON}
            disabled={disabled}
            loading={pending}
            loadingText="Signing in…"
          >
            Sign in
            <ArrowRight aria-hidden />
          </Button>
        </AppForm>
      </div>
      <div className={AUTH_FOOTER}>
        <Link href="/forgot-password" className={AUTH_LINK}>
          Forgot password?
        </Link>
        <Link
          href="/login"
          className="font-semibold text-aral-slate underline-offset-4 hover:text-aral-navy hover:underline"
        >
          School sign-in
        </Link>
      </div>
    </AuthCard>
  );
}
