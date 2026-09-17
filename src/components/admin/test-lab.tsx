"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { prepareTestLab, resetDemoData } from "@/lib/actions/demo";
import { startTestLabSession } from "@/lib/actions/accounts";
import { RESET_DEMO_CONFIRMATION } from "@/lib/validators/demo.schema";
import type { TestLabChecklistItem } from "@/lib/test-lab/checklist";
import type { TestLabPersona } from "@/lib/test-lab/personas";
import { TestLabChecklist } from "@/components/admin/test-lab/checklist";

export type TestLabPageData = {
  status: {
    demoSchoolExists: boolean;
    prepared: boolean;
    demoModeEnabled: boolean;
  };
  checklist: TestLabChecklistItem[];
};

const START_BUTTONS: { persona: TestLabPersona; label: string }[] = [
  { persona: "head", label: "Open as School Head" },
  { persona: "teacher", label: "Open as Teacher" },
  { persona: "pending-teacher", label: "Open as Pending Teacher" },
];

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return <Badge variant={ok ? "default" : "outline"}>{label}</Badge>;
}

/**
 * Super Admin Page Test Lab (docs/test-lab-spec.md, T7).
 *
 * Signs the admin into demo accounts inside `[demo school 1]` — saves are
 * real, but they land only in that one demo school, never a real one.
 */
export function TestLabClient({ data }: { data: TestLabPageData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [startPending, startStartTransition] = useTransition();
  const [confirm, setConfirm] = useState("");
  const [resetOpen, setResetOpen] = useState(false);

  function prepare() {
    startTransition(async () => {
      const res = await prepareTestLab();
      if (res && !res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Test data is ready.");
      router.refresh();
    });
  }

  function reset() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("confirm", confirm);
      const res = await resetDemoData(fd);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setConfirm("");
      setResetOpen(false);
      toast.success("Test data reset. Prepare it again before starting a session.");
      router.refresh();
    });
  }

  function start(persona: TestLabPersona) {
    startStartTransition(async () => {
      const fd = new FormData();
      fd.set("persona", persona);
      const res = await startTestLabSession(fd);
      // Success redirects away, so only a failure returns here.
      if (res && !res.ok) toast.error(res.error);
    });
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-primary" aria-hidden />
            What Page Test Lab does
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Page Test Lab signs you in as demo School Head and Teacher accounts in{" "}
            <span className="font-medium text-foreground">[demo school 1]</span> so you can open
            every page as they would see it, without creating a login or using a real person&rsquo;s
            account.
          </p>
          <p>
            Changes you make while signed in this way are saved, but only inside the demo school —
            they never touch a real school&rsquo;s data. Profile, password and email forms only
            preview what they would do; nothing is actually changed on those.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <StatusBadge ok={data.status.demoSchoolExists} label="Demo school" />
            <StatusBadge ok={data.status.prepared} label="Test data prepared" />
            <StatusBadge ok={data.status.demoModeEnabled} label="Demo mode on" />
          </div>
          {!data.status.demoModeEnabled ? (
            <p className="text-sm text-muted-foreground">
              Demo mode is informational here — Test Lab works whether it is on or off.
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {!data.status.demoSchoolExists ? (
              <Button asChild>
                <Link href="/admin/settings/demo">Create demo data</Link>
              </Button>
            ) : null}
            {data.status.demoSchoolExists && !data.status.prepared ? (
              <Button type="button" onClick={prepare} loading={pending} loadingText="Preparing…">
                Prepare test data
              </Button>
            ) : null}
            {data.status.demoSchoolExists ? (
              <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="outline">
                    Reset test data
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-destructive" aria-hidden />
                      Reset test data
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      This permanently deletes every demo school and everything recorded under
                      them — grades, sections, teacher accounts and learners — then rebuilds{" "}
                      <span className="font-medium text-foreground">[demo school 1]</span> empty.
                      After reset, test data must be prepared again before starting a session. It
                      cannot be undone, and it touches no real school.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <div className="space-y-1.5">
                    <Label htmlFor="test-lab-reset-confirm">
                      Type <span className="font-mono">{RESET_DEMO_CONFIRMATION}</span> to confirm
                    </Label>
                    <Input
                      id="test-lab-reset-confirm"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      autoComplete="off"
                      placeholder={RESET_DEMO_CONFIRMATION}
                    />
                  </div>
                  <AlertDialogFooter>
                    <AlertDialogCancel onClick={() => setConfirm("")}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        if (confirm.trim() !== RESET_DEMO_CONFIRMATION || pending) {
                          e.preventDefault();
                          return;
                        }
                        reset();
                      }}
                      disabled={confirm.trim() !== RESET_DEMO_CONFIRMATION || pending}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      Reset test data
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Start a session</CardTitle>
        </CardHeader>
        <CardContent>
          {!data.status.prepared ? (
            <p className="text-sm text-muted-foreground">
              Prepare test data above before starting a session.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {START_BUTTONS.map((b) => (
                <Button
                  key={b.persona}
                  type="button"
                  variant="secondary"
                  loading={startPending}
                  onClick={() => start(b.persona)}
                >
                  {b.label}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-base font-semibold text-foreground">Checklist</h2>
        <TestLabChecklist items={data.checklist} />
      </div>
    </div>
  );
}
