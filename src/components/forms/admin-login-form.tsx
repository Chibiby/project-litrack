"use client";

import { useTransition } from "react";
import Link from "next/link";
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
import { toFormData } from "@/lib/forms/to-form-data";

export function AdminLoginForm({ disabled = false }: { disabled?: boolean }) {
  const [pending, startTransition] = useTransition();
  const form = useAppForm<AdminLoginInput>({
    schema: adminLoginSchema,
    defaultValues: { email: "", password: "" },
  });

  return (
    <Card className="rounded-xl border border-border/80 bg-white shadow-sm">
      <CardContent className="pt-6">
        <AppForm
          form={form}
          className="space-y-4"
          onSubmit={(values) => {
            startTransition(async () => {
              const res = await loginAdmin(toFormData(values));
              if (res && !res.ok) toast.error(res.error);
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
          <Button type="submit" className="w-full" disabled={disabled || pending}>
            {pending ? "Signing in…" : "Sign in"}
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
