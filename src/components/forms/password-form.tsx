"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  setPasswordSchema,
  changePasswordSchema,
  type SetPasswordInput,
  type ChangePasswordInput,
} from "@/lib/validators/auth.schema";
import {
  setPasswordAction,
  changePasswordAction,
  completePasswordReset,
  skipPasswordChange,
} from "@/lib/actions/auth";
import { toFormData } from "@/lib/forms/to-form-data";

type Mode = "set" | "change" | "reset";

const PASSWORD_HINT = "Use at least 8 characters with a letter and a number.";

type ChangeValues = ChangePasswordInput;
type SetValues = SetPasswordInput;

export function PasswordForm({ mode, allowSkip = true }: { mode: Mode; allowSkip?: boolean }) {
  const [pending, startTransition] = useTransition();

  const title =
    mode === "set"
      ? "Set your password"
      : mode === "reset"
        ? "Choose a new password"
        : "Change password";

  if (mode === "change") {
    return (
      <PasswordFormChange title={title} pending={pending} startTransition={startTransition} />
    );
  }

  return (
    <PasswordFormSetOrReset
      mode={mode}
      allowSkip={allowSkip}
      title={title}
      pending={pending}
      startTransition={startTransition}
    />
  );
}

function PasswordFormChange({
  title,
  pending,
  startTransition,
}: {
  title: string;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
}) {
  const form = useAppForm<ChangeValues>({
    schema: changePasswordSchema,
    defaultValues: {
      currentPassword: "",
      password: "",
      confirmPassword: "",
    },
  });

  return (
    <Card className="rounded-xl border border-border/80 shadow-sm">
      <CardContent className="space-y-4 pt-6">
        <h2 className="text-lg font-semibold">{title}</h2>
        <AppForm
          form={form}
          className="space-y-4"
          onSubmit={(values) => {
            startTransition(async () => {
              const res = await changePasswordAction(toFormData(values));
              if (res && !res.ok) {
                toast.error(res.error);
                return;
              }
              toast.success("Password updated");
              markFormClean(form, {
                currentPassword: "",
                password: "",
                confirmPassword: "",
              });
            });
          }}
        >
          <FormField
            control={form.control}
            name="currentPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Current password</FormLabel>
                <FormControl>
                  <PasswordInput
                    autoComplete="current-password"
                    autoFocus
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
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>New password</FormLabel>
                <FormControl>
                  <PasswordInput
                    autoComplete="new-password"
                    disabled={pending}
                    {...field}
                  />
                </FormControl>
                <FormDescription>{PASSWORD_HINT}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Confirm new password</FormLabel>
                <FormControl>
                  <PasswordInput
                    autoComplete="new-password"
                    disabled={pending}
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
            loading={pending}
            loadingText="Updating…"
          >
            Update password
          </Button>
        </AppForm>
      </CardContent>
    </Card>
  );
}

function PasswordFormSetOrReset({
  mode,
  allowSkip,
  title,
  pending,
  startTransition,
}: {
  mode: "set" | "reset";
  allowSkip: boolean;
  title: string;
  pending: boolean;
  startTransition: React.TransitionStartFunction;
}) {
  const form = useAppForm<SetValues>({
    schema: setPasswordSchema,
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  const action = mode === "set" ? setPasswordAction : completePasswordReset;

  return (
    <Card className="rounded-xl border border-border/80 shadow-sm">
      <CardContent className="space-y-4 pt-6">
        <h2 className="text-lg font-semibold">{title}</h2>
        <AppForm
          form={form}
          className="space-y-4"
          onSubmit={(values) => {
            startTransition(async () => {
              const res = await action(toFormData(values));
              if (res && !res.ok) {
                toast.error(res.error);
                return;
              }
              toast.success(mode === "set" ? "Password saved" : "Password updated");
              markFormClean(form, { password: "", confirmPassword: "" });
            });
          }}
        >
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>New password</FormLabel>
                <FormControl>
                  <PasswordInput
                    autoComplete="new-password"
                    autoFocus
                    disabled={pending}
                    {...field}
                  />
                </FormControl>
                <FormDescription>{PASSWORD_HINT}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>Confirm new password</FormLabel>
                <FormControl>
                  <PasswordInput
                    autoComplete="new-password"
                    disabled={pending}
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
            loading={pending}
            loadingText="Saving…"
          >
            Save password
          </Button>
          {mode === "set" && allowSkip ? <SkipForNowButton disabled={pending} /> : null}
        </AppForm>
      </CardContent>
    </Card>
  );
}

/**
 * Only on `set` — the first-login nudge. `reset` is reached from a recovery
 * link, where the whole point of the visit is choosing a new password, and
 * `change` is voluntary and already dismissable by navigating away.
 *
 * Runs its own transition rather than sharing the form's `pending`, so the
 * spinner lands on the button that was actually clicked. It stays outside
 * `AppForm`'s submit path entirely (`type="button"`), so the empty password
 * fields never get validated on the way out.
 */
function SkipForNowButton({ disabled }: { disabled: boolean }) {
  const [skipping, startSkip] = useTransition();

  return (
    <div className="space-y-2 pt-1">
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        disabled={disabled}
        loading={skipping}
        loadingText="Skipping…"
        onClick={() => {
          startSkip(async () => {
            const res = await skipPasswordChange();
            // Success redirects, so only a failure ever returns here.
            if (res && !res.ok) toast.error(res.error);
          });
        }}
      >
        Skip for now
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        You will keep signing in with your current credential. You can change it
        any time from Settings → Security.
      </p>
    </div>
  );
}
