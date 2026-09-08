"use client";

import { useTransition } from "react";
import Link from "next/link";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
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

/** Mark next app shell paint to show the post-login splash (survives redirect). */
function markPostLoginSplash() {
  try {
    sessionStorage.setItem(POST_LOGIN_FLAG, "1");
  } catch {
    // sessionStorage unavailable — splash simply won't show
  }
}

export function AdminLoginForm({ disabled = false }: { disabled?: boolean }) {
  const [pending, startTransition] = useTransition();
  const form = useAppForm<AdminLoginInput>({
    schema: adminLoginSchema,
    defaultValues: { username: "", password: "" },
  });

  return (
    <Card className="rounded-xl border border-border/80 shadow-sm">
      <CardContent className="pt-6">
        <AppForm
          form={form}
          className="space-y-4"
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
                <FormLabel required>Username</FormLabel>
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
                <FormLabel required>Password</FormLabel>
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
            className="w-full"
            disabled={disabled}
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
        </AppForm>
      </CardContent>
    </Card>
  );
}
