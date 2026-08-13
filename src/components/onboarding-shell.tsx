"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { LogOut, Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { logoutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import {
  UnsavedChangesProvider,
  useUnsavedChanges,
} from "@/hooks/unsaved-changes-context";

/**
 * Client onboarding chrome: logo header + Sign out that respects unsaved profiling changes.
 */
export function OnboardingShell({ children }: { children: React.ReactNode }) {
  return (
    <UnsavedChangesProvider>
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-30 border-b border-border/80 bg-surface-header/90 backdrop-blur-md">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <div className="flex min-w-0 items-center gap-2.5">
              <Image
                src="/logo.png"
                alt="LITRACK logo"
                width={36}
                height={48}
                className="h-9 w-auto"
                priority
              />
              <span className="truncate text-sm font-bold tracking-tight text-foreground">
                LITRACK
              </span>
            </div>
            <GuardedSignOut />
          </div>
        </header>
        <main id="main-content" className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
          {children}
        </main>
      </div>
    </UnsavedChangesProvider>
  );
}

function GuardedSignOut() {
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Module store (not only React context) so dirty from the page form is visible
  // across the onboarding layout → page Server Component children boundary.
  const unsaved = useUnsavedChanges();
  const isDirty = unsaved.isDirty;
  const message =
    unsaved.message ||
    "You have unsaved changes. Leave this page? Your changes will be lost.";

  function submitLogout() {
    formRef.current?.requestSubmit();
  }

  function handleSignOutClick() {
    if (isDirty) {
      setConfirmOpen(true);
      return;
    }
    submitLogout();
  }

  return (
    <>
      {/*
        Keep the logout <form> free of AlertDialogTrigger asChild wrappers.
        SignOutTrigger is a custom component that does not forward Radix trigger
        props — nesting ConfirmAction's asChild trigger inside the form made
        dirty Sign out a no-op (dialog never opened).
      */}
      <form ref={formRef} action={logoutAction}>
        <SignOutTrigger type="button" onClick={handleSignOutClick} />
      </form>
      <ConfirmAction
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Leave profiling?"
        description={message}
        confirmLabel="Sign out"
        cancelLabel="Stay"
        variant="destructive"
        onConfirm={submitLogout}
      />
    </>
  );
}

function SignOutTrigger({
  type,
  onClick,
}: {
  type: "submit" | "button";
  onClick?: () => void;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-muted-foreground hover:text-foreground"
      type={type}
      disabled={pending}
      aria-busy={pending}
      onClick={onClick}
    >
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <LogOut className="mr-2 h-4 w-4" aria-hidden />
      )}
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
