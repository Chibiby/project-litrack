"use client";



import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

import { Loader2, LogOut } from "lucide-react";

import { cn } from "@/lib/utils";



/**

 * Submit control for logout forms. Must render inside `<form action={logoutAction}>`.

 */

export function SignOutButton({ className }: { className?: string }) {

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

      disabled={pending}

      aria-busy={pending}

    >

      {pending ? (

        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />

      ) : (

        <LogOut className="mr-2 h-4 w-4 text-red-600 dark:text-red-400" aria-hidden />

      )}

      {pending ? "Signing out…" : "Sign out"}

    </Button>

  );

}

