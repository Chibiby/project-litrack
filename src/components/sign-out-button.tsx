"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Loader2, LogOut } from "lucide-react";

/**
 * Submit control for logout forms. Must render inside `<form action={logoutAction}>`.
 */
export function SignOutButton() {
  const { pending } = useFormStatus();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start text-muted-foreground hover:text-foreground"
      type="submit"
      disabled={pending}
      aria-busy={pending}
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
