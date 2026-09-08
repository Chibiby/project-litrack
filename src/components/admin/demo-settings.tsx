"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Copy, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createDemoData, resetDemoData, setDemoMode } from "@/lib/actions/demo";
import { RESET_DEMO_CONFIRMATION } from "@/lib/validators/demo.schema";

export type DemoSettingsData = {
  enabled: boolean;
  exists: boolean;
  districtName: string;
  schoolName: string;
  schoolIdCode: string;
  schoolHeadEmail: string | null;
};

function Field({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="truncate font-mono text-sm text-foreground">{value}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
      </Button>
    </div>
  );
}

/**
 * The Super Admin's control over the training tenant.
 *
 * Two deliberately different weights of control: the visibility switch is
 * instant and reversible, so it acts on click; the reset destroys the demo
 * school, so it is behind a typed confirmation. Nothing on this page can reach a
 * real school.
 */
export function DemoSettings({ data }: { data: DemoSettingsData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(data.enabled);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [resetOpen, setResetOpen] = useState(false);

  function toggle() {
    const next = !enabled;
    setError(null);
    setNotice(null);
    // Optimistic: the switch is the whole affordance, so it has to move on click
    // or the page reads as broken. Rolled back below if the write fails.
    setEnabled(next);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("enabled", next ? "true" : "false");
      const res = await setDemoMode(fd);
      if (!res.ok) {
        setEnabled(!next);
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function create() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await createDemoData();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice("Demo data created. The School Head signs in with the School ID below.");
      router.refresh();
    });
  }

  function reset() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("confirm", confirm);
      const res = await resetDemoData(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirm("");
      setResetOpen(false);
      setNotice("Demo data reset. Everything recorded during the last run is gone.");
      router.refresh();
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      {error ? (
        <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
          {notice}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Demo mode</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-6">
            <div className="space-y-1">
              <p className="text-sm text-foreground">
                Show the training district and school on the login page
              </p>
              <p className="text-sm text-muted-foreground">
                While this is off, {data.districtName} and {data.schoolName} are hidden from the
                District and School dropdowns and left out of every dashboard count. Nothing is
                deleted — switch it back on and the demo returns exactly as it was.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={toggle}
              aria-label="Demo mode"
              disabled={pending}
              className="mt-1"
            />
          </div>

          {enabled && !data.exists ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              Demo mode is on, but the demo data has not been created yet. Nothing extra appears on
              the login page until you create it below.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Demo data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.exists ? (
            <>
              <div className="space-y-2">
                <Field label="District" value={data.districtName} />
                <Field label="School" value={data.schoolName} />
                <Field label="School ID / first-login password" value={data.schoolIdCode} />
              </div>
              <p className="text-sm text-muted-foreground">
                The School Head signs in by picking the district and school on the login page, then
                using the School ID as the password — the same first-login rule every real school
                follows, which is what the training video demonstrates.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No demo data yet. Creating it adds one district, one school with School ID{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{data.schoolIdCode}</code>, and
              its School Head account. Grades, sections, teachers and learners are then added live
              during the recording, which is the point of the walkthrough.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {!data.exists ? (
              <Button type="button" onClick={create} disabled={pending}>
                {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                Create demo data
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => setResetOpen((v) => !v)}
                disabled={pending}
              >
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                Reset demo data
              </Button>
            )}
          </div>

          {resetOpen ? (
            <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  This permanently deletes the demo school and everything recorded under it —
                  grades, sections, teacher accounts and learners — then rebuilds it empty. It
                  cannot be undone, and it touches no other school.
                </span>
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="demo-reset-confirm">
                  Type <span className="font-mono">{RESET_DEMO_CONFIRMATION}</span> to confirm
                </Label>
                <Input
                  id="demo-reset-confirm"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="off"
                  placeholder={RESET_DEMO_CONFIRMATION}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="destructive"
                  onClick={reset}
                  disabled={pending || confirm.trim() !== RESET_DEMO_CONFIRMATION}
                >
                  {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                  Reset demo data
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setResetOpen(false);
                    setConfirm("");
                  }}
                  disabled={pending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
