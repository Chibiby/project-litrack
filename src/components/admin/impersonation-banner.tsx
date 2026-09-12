"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { endImpersonation } from "@/lib/actions/accounts";
import { logoutAction } from "@/lib/actions/auth";
import { SignOutButton } from "@/components/sign-out-button";
import { UserCog } from "lucide-react";

/**
 * Sticky notice shown while a Super Admin is signed in as someone else.
 *
 * Deliberately loud and always visible: every write made from here is recorded
 * against the impersonated account, so the one thing this must never do is let
 * an admin forget whose session they are in.
 */
export function ImpersonationBanner({
  accountName,
  expired = false,
}: {
  accountName: string;
  expired?: boolean;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="sticky top-0 z-50 border-b border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/60 dark:text-amber-100">
      <div className="mx-auto flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <p className="flex items-center gap-2 text-sm">
          <UserCog className="h-4 w-4 shrink-0" aria-hidden />
          <span>
            Signed in as <strong className="font-semibold">{accountName}</strong> — anything you do
            here is recorded against their account.
            {expired && " The return window has expired; sign out to leave this session."}
          </span>
        </p>
        {expired ? (
          <form action={logoutAction}>
            <SignOutButton className="border border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-200 dark:border-amber-500/50 dark:bg-transparent dark:text-amber-100 dark:hover:bg-amber-900/50" />
          </form>
        ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          loading={pending}
          loadingText="Returning…"
          className="border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-200 dark:border-amber-500/50 dark:bg-transparent dark:text-amber-100 dark:hover:bg-amber-900/50"
          onClick={() => {
            startTransition(async () => {
              const res = await endImpersonation();
              // Success redirects to /admin/accounts, so only a failure returns here.
              if (res && !res.ok) toast.error(res.error);
            });
          }}
        >
          Return to admin
        </Button>
        )}
      </div>
    </div>
  );
}
