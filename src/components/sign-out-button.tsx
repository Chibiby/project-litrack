"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

import { LogOut } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Submit control for logout forms. Must render inside `<form action={logoutAction}>`.
 */
export function SignOutButton({
  className,
  iconOnly = false,
}: {
  className?: string;
  iconOnly?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(
        "justify-start text-muted-foreground hover:text-red-700 dark:hover:text-red-400",
        className ?? "w-full"
      )}
      type="submit"
      loading={pending}
      // Collapsed to an icon there is no room for a label, so the spinner stands
      // in for it and the sr-only text below carries the state instead.
      loadingText={iconOnly ? undefined : "Signing out…"}
      aria-label={iconOnly ? (pending ? "Signing out…" : "Sign out") : undefined}
    >
      {pending ? null : (
        <LogOut className="mr-2 h-4 w-4 text-red-600 dark:text-red-400" aria-hidden />
      )}
      {iconOnly ? (
        <span className="sr-only">{pending ? "Signing out…" : "Sign out"}</span>
      ) : (
        "Sign out"
      )}
    </Button>
  );
}
