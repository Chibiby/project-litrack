"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * The POST spends a one-time token, so the button locks once the person
 * submits. `useFormStatus` is not used: this is a native form POST (string
 * `action`), which React does not track as a pending action.
 */
export function ConfirmForm({ tokenHash, type }: { tokenHash: string; type: string }) {
  const [submitting, setSubmitting] = useState(false);

  // Coming back via the browser's back button restores this page from the
  // bfcache with the button still locked.
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) setSubmitting(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  return (
    <form method="POST" action="/auth/confirm/verify" onSubmit={() => setSubmitting(true)}>
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={type} />
      <Button type="submit" className="w-full" loading={submitting} loadingText="Verifying…">
        Continue to reset password
      </Button>
    </form>
  );
}
