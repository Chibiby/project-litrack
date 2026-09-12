"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Copy, Eye, EyeOff, KeyRound, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmAction } from "@/components/confirm-action";
import { AccountProfileDialog } from "@/components/admin/account-profile-dialog";
import {
  revealSchoolHeadPassword,
  resetSchoolHeadPasswordToDefault,
  resetTeacherPassword,
  impersonateUser,
} from "@/lib/actions/accounts";
import type { AccountRow } from "@/lib/admin/accounts";

/**
 * The Password column. A teacher or Super Admin row can only ever carry
 * `never_stored` (`accountPasswordState` in `@/lib/admin/accounts` produces
 * `sealed` / `school_id` / `not_recorded` only inside the `SCHOOL_HEAD`
 * branch), so this component cannot render a reveal control on a teacher row.
 */
export function PasswordCell({ row }: { row: AccountRow }) {
  const [revealed, setRevealed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const password = row.password;
  const reasonId = useId();
  const isNonSignInHead = row.role === "SCHOOL_HEAD" && !row.signInHead;

  // A row's password state is a fresh object every time the server re-sends
  // it (e.g. after `router.refresh()` following a reset), so keying on its
  // shape — not the row's identity, which is unchanged — clears a stale
  // reveal the instant the underlying credential does.
  const passwordKey = `${password.kind}:${"value" in password ? password.value : ""}`;
  useEffect(() => {
    setRevealed(null);
  }, [passwordKey]);

  if (password.kind === "never_stored") {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  if (password.kind === "not_recorded") {
    return <span className="text-sm text-muted-foreground">Not on record</span>;
  }

  const reasonNote = isNonSignInHead ? (
    <p id={reasonId} className="text-xs text-muted-foreground">
      Not the account this school signs in with.
    </p>
  ) : null;

  if (revealed) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="break-all font-mono text-xs">{revealed}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => setRevealed(null)}
          aria-label={`Hide password for ${row.fullName}`}
        >
          <EyeOff className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    );
  }

  // The School ID is not a secret — it is printed on the schools table and
  // already known to the row's own School Head — so this reads it back
  // without a server round trip or an audit row.
  if (password.kind === "school_id") {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={isNonSignInHead}
          aria-describedby={isNonSignInHead ? reasonId : undefined}
          onClick={() => setRevealed(password.value)}
        >
          <Eye className="h-3.5 w-3.5" aria-hidden />
          School ID
        </Button>
        {reasonNote}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs"
        loading={pending}
        loadingText="Revealing…"
        disabled={isNonSignInHead}
        aria-describedby={isNonSignInHead ? reasonId : undefined}
        onClick={() => {
          const fd = new FormData();
          fd.set("userId", row.id);
          startTransition(async () => {
            const res = await revealSchoolHeadPassword(fd);
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            if (res.data) setRevealed(res.data.password);
          });
        }}
      >
        <Eye className="h-3.5 w-3.5" aria-hidden />
        Reveal
      </Button>
      {reasonNote}
    </div>
  );
}

/**
 * Row controls, by role (spec section 3.1):
 *  - View profile: every row.
 *  - Sign in as: every row except Super Admin — the server refuses that
 *    target too, this is only the courtesy of not offering the button.
 *  - Reset password: School Heads reset to the School ID; teachers get a
 *    fresh random one-time credential. Both are shown exactly once.
 */
export function AccountRowActions({ row }: { row: AccountRow }) {
  const router = useRouter();
  const [credential, setCredential] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const reasonId = useId();

  const canResetPassword = row.role === "SCHOOL_HEAD" || row.role === "TEACHER";
  const isNonSignInHead = row.role === "SCHOOL_HEAD" && !row.signInHead;

  const resetDescription =
    row.role === "SCHOOL_HEAD"
      ? `Put ${row.fullName}'s password back to their School ID? Any password they chose stops working immediately. This is shown once and cannot be read again — write it down now.`
      : row.canRecoverByEmail
        ? `Issue ${row.fullName} a new one-time password? Their current password stops working. If their email works, "Forgot password" is preferred — it never puts a credential in your hands. This is shown once and cannot be read again — write it down now.`
        : `Issue ${row.fullName} a new one-time password? Their current password stops working, and this account has no working mailbox, so this is the only way back in. This is shown once and cannot be read again — write it down now.`;

  const runReset = async () => {
    const fd = new FormData();
    fd.set("userId", row.id);
    const res =
      row.role === "SCHOOL_HEAD"
        ? await resetSchoolHeadPasswordToDefault(fd)
        : await resetTeacherPassword(fd);
    if (!res.ok) {
      toast.error(res.error);
      throw new Error(res.error);
    }
    setCredential(res.data?.password ?? null);
    router.refresh();
  };

  const runImpersonate = async () => {
    const fd = new FormData();
    fd.set("userId", row.id);
    const res = await impersonateUser(fd);
    // Success redirects to /teacher or /school-head, so only a failure
    // returns here.
    if (res && !res.ok) {
      toast.error(res.error);
      throw new Error(res.error);
    }
  };

  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setProfileOpen(true)}>
            View profile
          </Button>

          {row.role !== "SUPER_ADMIN" ? (
            <ConfirmAction
              title={`Sign in as ${row.fullName}?`}
              description={`You will be signed in as ${row.fullName} until you end the session from the banner. Everything you do while signed in is recorded against their account.`}
              confirmLabel="Sign in as"
              variant="default"
              disabled={isNonSignInHead}
              trigger={
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isNonSignInHead}
                  aria-describedby={isNonSignInHead ? reasonId : undefined}
                  className="border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-transparent dark:text-amber-300"
                >
                  <UserCog className="mr-1.5 h-4 w-4" aria-hidden />
                  Sign in as
                </Button>
              }
              onConfirm={runImpersonate}
            />
          ) : null}

          {canResetPassword ? (
            <ConfirmAction
              title={row.role === "SCHOOL_HEAD" ? "Reset to the School ID?" : "Issue a new password?"}
              description={resetDescription}
              confirmLabel={row.role === "SCHOOL_HEAD" ? "Reset password" : "Issue password"}
              variant="destructive"
              disabled={isNonSignInHead}
              trigger={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={isNonSignInHead}
                  aria-describedby={isNonSignInHead ? reasonId : undefined}
                >
                  <KeyRound className="mr-1.5 h-4 w-4" aria-hidden />
                  Reset
                </Button>
              }
              onConfirm={runReset}
            />
          ) : null}
        </div>
        {isNonSignInHead ? (
          <p id={reasonId} className="text-xs text-muted-foreground">
            Not the account this school signs in with.
          </p>
        ) : null}
      </div>

      <Dialog
        open={credential !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCredential(null);
            setCopied(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New password issued</DialogTitle>
            <DialogDescription>
              This is shown once and cannot be read again. Write it down now.
            </DialogDescription>
          </DialogHeader>
          <div className="break-all rounded-lg border bg-muted/40 p-3 font-mono text-sm">
            {credential}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                if (!credential) return;
                await navigator.clipboard.writeText(credential);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? (
                <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden />
              ) : (
                <Copy className="mr-2 h-4 w-4" aria-hidden />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button type="button" onClick={() => setCredential(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AccountProfileDialog row={row} open={profileOpen} onOpenChange={setProfileOpen} />
    </>
  );
}
