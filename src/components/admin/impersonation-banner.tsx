"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { endImpersonation } from "@/lib/actions/accounts";
import { logoutAction } from "@/lib/actions/auth";
import { SignOutButton } from "@/components/sign-out-button";
import { FlaskConical, UserCog } from "lucide-react";

export type TestLabBannerInfo = { pages: { label: string; href: string }[] };

/**
 * Sticky notice shown while a Super Admin is signed in as someone else.
 *
 * Deliberately loud and always visible: every write made from here is recorded
 * against the impersonated account, so the one thing this must never do is let
 * an admin forget whose session they are in. `testLab` swaps the copy and the
 * exit label for a Page Test Lab session (docs/test-lab-spec.md, T8); an
 * ordinary impersonation — `testLab` omitted — looks exactly as before.
 */
export function ImpersonationBanner({
  accountName,
  expired = false,
  testLab = null,
}: {
  accountName: string;
  expired?: boolean;
  testLab?: TestLabBannerInfo | null;
}) {
  const [pending, startTransition] = useTransition();

  function backToAdmin() {
    startTransition(async () => {
      const res = await endImpersonation();
      // Success redirects (to Test Lab or the accounts console), so only a
      // failure returns here.
      if (res && !res.ok) toast.error(res.error);
    });
  }

  return (
    <div className="sticky top-0 z-50 border-b border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/60 dark:text-amber-100">
      <div className="mx-auto flex flex-wrap items-center justify-between gap-2 px-4 py-2">
        <p className="flex items-center gap-2 text-sm">
          {testLab ? (
            <FlaskConical className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <UserCog className="h-4 w-4 shrink-0" aria-hidden />
          )}
          <span>
            {testLab ? (
              <>
                <strong className="font-semibold">Test Lab — demo data.</strong> Signed in as{" "}
                <strong className="font-semibold">{accountName}</strong>; changes are saved only to
                the demo school.
              </>
            ) : (
              <>
                Signed in as <strong className="font-semibold">{accountName}</strong> — anything you
                do here is recorded against their account.
              </>
            )}
            {expired && " The return window has expired; sign out to leave this session."}
          </span>
        </p>
        <div className="flex items-center gap-2">
          {testLab && !expired ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-200 dark:border-amber-500/50 dark:bg-transparent dark:text-amber-100 dark:hover:bg-amber-900/50"
                >
                  Pages
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-2">
                {testLab.pages.length === 0 ? (
                  <p className="px-2 py-1 text-sm text-muted-foreground">
                    No checklist pages yet — prepare test data in Test Lab.
                  </p>
                ) : (
                  <ul className="max-h-80 space-y-0.5 overflow-y-auto">
                    {testLab.pages.map((p) => (
                      <li key={p.href}>
                        <Link
                          href={p.href}
                          className="block rounded px-2 py-1.5 text-sm hover:bg-muted"
                        >
                          {p.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </PopoverContent>
            </Popover>
          ) : null}
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
              onClick={backToAdmin}
            >
              {testLab ? "Back to Test Lab" : "Return to admin"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
