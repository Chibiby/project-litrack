"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { UserCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Surface } from "@/components/ui/surface";
import { clearAutoApproveWindow, setAutoApproveWindow } from "@/lib/actions/database";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";
import { autoApproveState, parseAutoApproveWindow } from "@/lib/teachers/auto-approve";

export type AutoApproveWindowData = { start: string; end: string } | null;

/** A Date as the `YYYY-MM-DDTHH:mm` a datetime-local input takes, in local time. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function formatWhen(date: Date): string {
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATE_BADGE = {
  off: { label: "Off", variant: "secondary" },
  scheduled: { label: "Scheduled", variant: "outline" },
  open: { label: "On now", variant: "default" },
  ended: { label: "Ended", variant: "secondary" },
} as const;

/**
 * Database console: the automatic teacher approval window. Between the start
 * and end time, teachers who create an account are approved into the school
 * they picked, with no School Head step.
 */
export function AutoApproveWindowPanel({ value: saved }: { value: AutoApproveWindowData }) {
  const current = saved ? parseAutoApproveWindow(JSON.stringify(saved)) : null;
  const state = autoApproveState(current);

  const [start, setStart] = useState(() => toLocalInput(current?.start ?? new Date()));
  const [end, setEnd] = useState(() =>
    toLocalInput(current?.end ?? new Date(Date.now() + 24 * 60 * 60 * 1000))
  );
  const [saving, startSave] = useTransition();
  const [clearing, startClear] = useTransition();

  const save = () => {
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      toast.error("Enter both a start and an end time.");
      return;
    }
    const formData = new FormData();
    formData.set("start", startDate.toISOString());
    formData.set("end", endDate.toISOString());
    startSave(async () => {
      const res = await callAction(() => setAutoApproveWindow(formData));
      if (!res.ok) {
        toastFailure(res);
        return;
      }
      toast.success(
        `New teacher accounts are approved automatically from ${formatWhen(startDate)} to ${formatWhen(endDate)}`
      );
    });
  };

  const turnOff = () => {
    startClear(async () => {
      const res = await callAction(() => clearAutoApproveWindow());
      if (!res.ok) {
        toastFailure(res);
        return;
      }
      toast.success("Automatic approval is off. New teachers wait for School Head approval.");
    });
  };

  const badge = STATE_BADGE[state];

  return (
    <Surface as="section" className="min-w-0 space-y-4 rounded-lg p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <UserCheck className="h-5 w-5" aria-hidden />
            Automatic teacher approval
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Between the start and end time, every teacher who creates an account is approved into
            the school they pick. No School Head approval is needed. They go back to the sign-in
            page, sign in, and set up their profile. Outside this time, new accounts wait for School
            Head approval as usual.
          </p>
        </div>
        <Badge variant={badge.variant}>{badge.label}</Badge>
      </div>

      {current ? (
        <p className="text-sm">
          {state === "ended" ? "Last window: " : "Window: "}
          <span className="font-medium">{formatWhen(current.start)}</span> to{" "}
          <span className="font-medium">{formatWhen(current.end)}</span>
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">Start</span>
          <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="space-y-1.5 text-sm">
          <span className="font-medium">End</span>
          <Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={save} loading={saving} loadingText="Saving…" disabled={clearing}>
          {current && state !== "ended" ? "Update window" : "Turn on for this time"}
        </Button>
        {current && state !== "ended" ? (
          <Button
            type="button"
            variant="outline"
            onClick={turnOff}
            loading={clearing}
            loadingText="Turning off…"
            disabled={saving}
          >
            Turn off now
          </Button>
        ) : null}
      </div>
    </Surface>
  );
}
