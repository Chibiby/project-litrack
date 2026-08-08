"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
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
import { AppForm, useAppForm } from "@/components/forms/app-form";
import { forgotPasswordSchema } from "@/lib/validators/auth.schema";
import { requestPasswordReset } from "@/lib/actions/auth";
import { toFormData } from "@/lib/forms/to-form-data";
import { z } from "zod";

const SUCCESS_MESSAGE =
  "If an account exists for that email, a reset link has been sent.";

type ForgotValues = z.infer<typeof forgotPasswordSchema>;

export function ForgotPasswordForm() {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const form = useAppForm<ForgotValues>({
    schema: forgotPasswordSchema,
    defaultValues: { email: "" },
  });

  if (done) {
    return (
      <Card className="rounded-xl border border-border/80 bg-white shadow-sm">
        <CardContent className="space-y-4 pt-6">
          <h2 className="text-lg font-semibold">Check your email</h2>
          <p className="text-sm text-muted-foreground">{SUCCESS_MESSAGE}</p>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Back to sign in</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border border-border/80 bg-white shadow-sm">
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
            startTransition(async () => {
              const res = await requestPasswordReset(toFormData(values));
              if (!res.ok) {
                toast.error(res.error);
                return;
              }
              setDone(true);
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
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Sending…" : "Send reset link"}
          </Button>
        </AppForm>
        <p className="text-center text-xs text-muted-foreground">
          <Link href="/login" className="underline hover:text-foreground">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
