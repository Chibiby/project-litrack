"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
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
  FormDescription,
  FormMessage,
} from "@/components/ui/form";
import { AppForm, useAppForm, markFormClean } from "@/components/forms/app-form";
import {
  changeEmailSchema,
  type ChangeEmailInput,
} from "@/lib/validators/auth.schema";
import { changeEmailAction } from "@/lib/actions/auth";
import { toFormData } from "@/lib/forms/to-form-data";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";

type Props = {
  currentEmail: string;
  isSynthetic?: boolean;
};

export function ChangeEmailForm({ currentEmail, isSynthetic }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const synthetic = isSynthetic ?? isSyntheticEmail(currentEmail);

  const form = useAppForm<ChangeEmailInput>({
    schema: changeEmailSchema,
    defaultValues: {
      newEmail: "",
      confirmEmail: "",
      currentPassword: "",
    },
  });

  return (
    <Card className="rounded-xl border border-border/80 shadow-sm">
      <CardContent className="space-y-4 pt-6">
        <h2 className="text-lg font-semibold">Change email</h2>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Current email</p>
          <Input value={currentEmail} readOnly disabled className="bg-muted" />
          {synthetic ? (
            <p className="text-sm text-muted-foreground">
              This is your login identity. Changing it updates how you authenticate.
              School Heads still sign in with school + password; teachers and admins
              use the new email on login.
            </p>
          ) : null}
        </div>
        <AppForm
          form={form}
          className="space-y-4"
          onSubmit={(values) => {
            startTransition(async () => {
              const res = await changeEmailAction(toFormData(values));
              if (res && !res.ok) {
                toast.error(res.error);
                return;
              }
              toast.success("Email updated");
              markFormClean(form, {
                newEmail: "",
                confirmEmail: "",
                currentPassword: "",
              });
              router.refresh();
            });
          }}
        >
          <FormField
            control={form.control}
            name="newEmail"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>New email</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    disabled={pending}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmEmail"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Confirm new email</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    autoComplete="email"
                    disabled={pending}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="currentPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Current password</FormLabel>
                <FormControl>
                  <PasswordInput
                    autoComplete="current-password"
                    disabled={pending}
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Confirm your password to change your email.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            className="w-full"
            loading={pending}
            loadingText="Updating…"
          >
            Update email
          </Button>
        </AppForm>
      </CardContent>
    </Card>
  );
}
