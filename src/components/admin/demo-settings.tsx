"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Loader2,
  RotateCcw,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createDemoData,
  endDemoSession,
  resetDemoData,
  startDemoSession,
} from "@/lib/actions/demo";
import { RESET_DEMO_CONFIRMATION } from "@/lib/validators/demo.schema";

export type DemoSettingsData = {
  /** Epoch ms this browser's demo session ends, or null when there is none. */
  sessionExpiresAt: number | null;
  /** Every demo school exists. */
  complete: boolean;
  /** At least one does — a partly built set still needs the create button. */
  any: boolean;
  districtName: string;
  /** Shared by all demo schools; also each School Head first-login password. */
  schoolIdCode: string;
  schools: { name: string; exists: boolean }[];
};

function Field({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="truncate font-mono text-sm text-foreground">{value}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="sm:h-10 lg:h-9"
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

/** Mount detection only, so nothing ever has to be re-subscribed. */
function subscribeNever(): () => void {
  return () => {};
}

/** The server and the first client paint must agree: no local clock yet. */
function getServerMounted(): boolean {
  return false;
}

function getClientMounted(): boolean {
  return true;
}

/**
 * The Super Admin's control over the training tenant.
 *
 * Three deliberately different weights of control. Opening a demo session is
 * instant and affects only this browser, so it acts on click and opens the
 * login page in a new tab, where the demo schools are now selectable. Ending it
 * is one click too, because hiding demo data is never the risky direction. The
 * reset destroys the demo schools, so it stays behind a typed confirmation.
 * Nothing on this page can reach a real school.
 */
export function DemoSettings({ data }: { data: DemoSettingsData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [resetOpen, setResetOpen] = useState(false);

  // Formatted after mount, never during SSR: the server formats in UTC and the
  // browser in Asia/Manila, which is a hydration mismatch on every load. Same
  // `useSyncExternalStore` shape as `useWelcomeLocale` — the server snapshot is
  // null, the client one is the local time, and no effect writes state.
  const mounted = useSyncExternalStore(subscribeNever, getClientMounted, getServerMounted);
  const endsAt =
    mounted && data.sessionExpiresAt !== null
      ? new Date(data.sessionExpiresAt).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })
      : null;

  const active = data.sessionExpiresAt !== null;

  function openSession() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await startDemoSession();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // A new tab, not this one: the admin keeps this page — and their admin
      // session — while the demo runs beside it.
      window.open("/login", "_blank", "noopener");
      setNotice(
        "Demo session open in this browser. The demo district and schools are now on the login page, for you only."
      );
      router.refresh();
    });
  }

  function closeSession() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await endDemoSession();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setNotice("Demo session ended. The demo district and schools are hidden again.");
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
      setNotice(
        `Demo data ready — ${res.data?.count ?? 0} schools. Each School Head signs in with the School ID below.`
      );
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

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>Demo session</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {data.districtName} and its demo school are hidden from everyone by default — not in
            the District and School dropdowns, not signable-in to, and left out of every dashboard
            count. Opening a demo session reveals them in <strong>this browser only</strong>, for
            up to four hours. No teacher, School Head or visitor is affected at any point.
          </p>

          {active ? (
            <div className="space-y-3 rounded-lg border border-violet-300/70 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-950/40">
              <p className="text-sm font-medium text-violet-900 dark:text-violet-100">
                Demo session active{endsAt ? ` — ends at ${endsAt}` : ""}
              </p>
              <p className="text-sm text-violet-900/80 dark:text-violet-200/80">
                Signing out of any account in this browser ends it, and so does closing the
                browser. Until then the demo schools appear on the login page for you.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => window.open("/login", "_blank", "noopener")}
                  disabled={pending}
                >
                  <ExternalLink className="mr-2 h-4 w-4" aria-hidden />
                  Open the demo login page
                </Button>
                <Button type="button" variant="secondary" onClick={closeSession} disabled={pending}>
                  {pending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Square className="mr-2 h-4 w-4" aria-hidden />
                  )}
                  End demo session
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" onClick={openSession} disabled={pending || !data.any}>
              {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              Open demo session
            </Button>
          )}

          {!data.any ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              There is no demo data to open a session on yet. Create it below first.
            </p>
          ) : !data.complete ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              Some demo schools are missing. Create the rest below.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle>Demo data</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.any ? (
            <>
              <div className="space-y-2">
                <Field label="District" value={data.districtName} />
                {data.schools.map((school) => (
                  <div
                    key={school.name}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        School
                      </p>
                      <p className="truncate font-mono text-sm text-foreground">{school.name}</p>
                    </div>
                    {school.exists ? (
                      <span className="shrink-0 text-xs font-medium text-muted-foreground">
                        Ready
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-300">
                        Not created
                      </span>
                    )}
                  </div>
                ))}
                <Field label="School ID / first-login password" value={data.schoolIdCode} />
              </div>
              <p className="text-sm text-muted-foreground">
                The School Head signs in by picking the district and school on the login page,
                then using the School ID above as the password — the same first-login rule every
                real school follows, which is what the training video demonstrates.
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No demo data yet. Creating it adds one district and one school —{" "}
              {data.schools.map((s) => s.name).join(", ")} — with School ID{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">{data.schoolIdCode}</code> and
              its own School Head account. Grades, sections, teachers and learners are then added
              live during the recording, which is the point of the walkthrough.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            {/* Both buttons show while the set is partly built: create finishes
                the missing schools, reset starts the whole set over. */}
            {!data.complete ? (
              <Button type="button" onClick={create} disabled={pending}>
                {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                {data.any ? "Create missing demo schools" : "Create demo data"}
              </Button>
            ) : null}
            {data.any ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setResetOpen((v) => !v)}
                disabled={pending}
              >
                <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                Reset demo data
              </Button>
            ) : null}
          </div>

          {resetOpen ? (
            <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
              <p className="flex items-start gap-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  This permanently deletes every demo school — including any earlier demo schools
                  left over from before — and everything recorded under them: grades, sections,
                  teacher accounts and learners. It then rebuilds {data.districtName} and{" "}
                  {data.schools[0]?.name ?? "the demo school"} empty. It cannot be undone, and it
                  touches no real school.
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
              <div className="flex flex-wrap gap-2">
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
