"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from "@/components/ui/form";
import { AppForm, applyFieldErrors, useAppForm } from "@/components/forms/app-form";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";
import { forgotPasswordSchema } from "@/lib/validators/auth.schema";
import { requestPasswordReset } from "@/lib/actions/auth";
import { toFormData } from "@/lib/forms/to-form-data";
import { z } from "zod";

const SUCCESS_MESSAGE =
  "We sent a reset link. Check your inbox and spam folder, and use the newest email — each new request cancels the previous link.";

// Supabase keeps one live recovery token per user, so resending sooner than
// this only trades the still-good earlier email for an identical new one.
// Same UI for everyone, whether or not the account actually exists.
const RESEND_COOLDOWN_SECONDS = 120;

type ForgotValues = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordForm() {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);
  const emailRef = useRef("");
  const form = useAppForm<ForgotValues>({
    schema: forgotPasswordSchema,
    defaultValues: { email: "" },
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => {
      setCooldown((s) => Math.max(0, s - 1));
    }, 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  const resend = useCallback(() => {
    startTransition(async () => {
      const res = await callAction(() =>
        requestPasswordReset(toFormData({ email: emailRef.current }))
      );
      if (!res.ok) {
        toastFailure(res);
        return;
      }
      setCooldown(RESEND_COOLDOWN_SECONDS);
    });
  }, [startTransition]);

  if (done) {
    return (
      <Card className="rounded-xl border border-border/80 shadow-sm">
        <CardContent className="space-y-4 pt-6">
          <h2 className="text-lg font-semibold">Check your email</h2>
          <p className="text-sm text-muted-foreground">{SUCCESS_MESSAGE}</p>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={pending || cooldown > 0}
            onClick={resend}
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend"}
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border border-border/80 shadow-sm">
      <CardContent className="space-y-4 pt-6">
        <h2 className="text-lg font-semibold">Reset password</h2>
        <p className="text-sm text-muted-foreground">
          Enter the email on your account. School Head accounts without a recovery email: contact
          your administrator to regenerate credentials. Teachers sign in with the password they
          set when creating their account.
        </p>
        <AppForm
          form={form}
          className="space-y-4"
          onSubmit={(values) => {
            emailRef.current = values.email;
            setFormError(null);
            startTransition(async () => {
              const res = await callAction(() => requestPasswordReset(toFormData(values)));
              if (!res.ok) {
                if (!applyFieldErrors(form, res)) setFormError(res.error);
                return;
              }
              setDone(true);
              setCooldown(RESEND_COOLDOWN_SECONDS);
            });
          }}
        >
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Email</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    autoFocus
                    disabled={pending}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
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
            className="w-full"
            loading={pending}
            loadingText="Sending…"
          >
            Send reset link
          </Button>
        </AppForm>
        <p className="text-center text-xs text-muted-foreground">
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center text-sm underline hover:text-foreground"
          >
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
