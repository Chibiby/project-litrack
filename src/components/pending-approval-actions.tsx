"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/sign-out-button";
import { logoutAction } from "@/lib/actions/auth";

export function PendingApprovalActions() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-2">
      <Button
        type="button"
        className="w-full"
        loading={pending}
        loadingText="Checking…"
        onClick={() => {
          startTransition(() => {
            router.refresh();
          });
        }}
      >
        Check approval status
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        After approval you can sign in and complete teacher profiling.
      </p>
      <form action={logoutAction}>
        <SignOutButton />
      </form>
    </div>
  );
}
