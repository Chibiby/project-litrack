"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, LockOpen } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { setSubmissionLocking } from "@/lib/actions/submission-locking";

/**
 * The Super Admin's one control over submission deadlines.
 *
 * Same weight and same shape as the demo visibility switch: instant, reversible,
 * acts on click, rolls back if the write fails. Nothing here destroys anything —
 * turning locking on does not revoke a grant, and turning it off does not delete
 * one.
 */
export function SubmissionLockingSettings({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [on, setOn] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !on;
    setError(null);
    // Optimistic: the switch is the whole affordance, so it has to move on click
    // or the page reads as broken. Rolled back below if the write fails.
    setOn(next);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("enabled", next ? "true" : "false");
      const res = await setSubmissionLocking(fd);
      if (!res.ok) {
        setOn(!next);
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {on ? (
              <Lock className="h-4 w-4" aria-hidden />
            ) : (
              <LockOpen className="h-4 w-4" aria-hidden />
            )}
            Submission deadlines
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="submission-locking">Enforce deadlines</Label>
              <p className="text-sm text-muted-foreground">
                {on
                  ? "ARAL weekly attendance locks after its deadline and a term closes when its months have passed. A teacher can still be reopened individually by an unlock grant."
                  : "Every week and every term is open. Teachers can encode and correct at any time, and no unlock grant is needed."}
              </p>
            </div>
            <Switch
              id="submission-locking"
              checked={on}
              disabled={pending}
              onCheckedChange={toggle}
              aria-label="Enforce submission deadlines"
            />
          </div>

          <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            Individual unlock grants are never changed by this switch. While
            deadlines are off they are simply not consulted; they start applying
            again the moment deadlines are switched back on.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
