"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { regenerateSchoolHeadCredential } from "@/lib/actions/school";

/**
 * Puts the School Head's password back to the School ID
 * (`regenerateSchoolHeadCredential`, scoped server-side). The School ID is not
 * a secret, so showing it back here hands out nothing new.
 */
export function SchoolHeadReset({
  schoolId,
  schoolName,
}: {
  schoolId: string;
  schoolName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [credential, setCredential] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = () =>
    new Promise<void>((resolve, reject) => {
      const fd = new FormData();
      fd.set("schoolId", schoolId);
      startTransition(async () => {
        const res = await regenerateSchoolHeadCredential(fd);
        if (!res.ok) {
          toast.error(res.error);
          reject(new Error(res.error));
          return;
        }
        setCredential(res.data.password);
        toast.success("School Head password reset to the School ID");
        resolve();
      });
    });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        If the School Head cannot sign in, put their password back to the School ID. Any password
        they chose stops working. They can choose a private one after signing in.
      </p>

      {credential ? (
        <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p className="text-sm font-medium">The School Head can sign in now with:</p>
          </div>
          <div className="break-all rounded-lg border bg-card p-3 font-mono text-sm text-foreground">
            {credential}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="sm:h-10"
              onClick={async () => {
                await navigator.clipboard.writeText(credential);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? <CheckCircle2 aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button type="button" size="sm" className="sm:h-10" onClick={() => setCredential(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmAction
        title="Reset the School Head password?"
        description={`The School Head of ${schoolName} will sign in with the School ID. Any password they chose stops working immediately.`}
        confirmLabel="Reset password"
        variant="destructive"
        disabled={pending}
        trigger={
          <Button type="button" variant="outline" className="w-full sm:w-auto" loading={pending} loadingText="Resetting…">
            <KeyRound aria-hidden />
            Reset School Head password
          </Button>
        }
        onConfirm={reset}
      />
    </div>
  );
}
