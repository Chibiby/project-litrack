"use client";

import { useTransition } from "react";
import Link from "next/link";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
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
  AUTH_LABEL,
  AUTH_LINK,
  AUTH_PRIMARY_BUTTON,
  AuthCard,
  AuthCardHeader,
} from "@/components/auth/auth-card";

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
    <AuthCard>
      <AuthCardHeader
        icon={ShieldCheck}
        title="Admin sign-in"
        subtitle="Division and district admin sign-in"
      />
      <div className="mt-6 space-y-5 2xl:mt-8">
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
                <FormLabel required className={AUTH_LABEL}>
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
                <FormLabel required className={AUTH_LABEL}>
                  Password
                </FormLabel>
                <FormControl>
                  <PasswordInput
                    autoComplete="current-password"
                    disabled={disabled || pending}
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
          </Button>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-base font-medium">
            <Link href="/forgot-password" className={AUTH_LINK}>
              Forgot password?
            </Link>
            <Link href="/login" className={AUTH_LINK}>
              School login
            </Link>
          </div>
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
