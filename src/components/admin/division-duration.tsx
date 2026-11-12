"use client";

import { useId, useState, useTransition } from "react";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Callout } from "@/components/ui/callout";
import { Surface, SurfaceBody, SurfaceHeader } from "@/components/ui/surface";
import { setDivisionActiveDuration } from "@/lib/actions/school-year";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";
import { monthLabel } from "@/components/school-head/school-year-forms";

export type DurationRow = {
  label: string;
  /** `YYYY-MM`, or null when the Division Admin has not set one. */
  startMonth: string | null;
  endMonth: string | null;
  state: "OPEN" | "NOT_STARTED" | "ENDED" | "NOT_SET";
  isLastMonth: boolean;
  schools: number;
};

const STATE_BADGE: Record<DurationRow["state"], { text: string; variant: "default" | "secondary" | "outline" }> = {
  OPEN: { text: "Active now", variant: "default" },
  NOT_STARTED: { text: "Not started", variant: "outline" },
  ENDED: { text: "Ended", variant: "secondary" },
  NOT_SET: { text: "Duration not set", variant: "outline" },
};

function SetDurationDialog({ row }: { row: DurationRow }) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(row.startMonth ?? `${row.label.slice(0, 4)}-06`);
  const [end, setEnd] = useState(row.endMonth ?? `${row.label.slice(5, 9)}-04`);
  const [pending, startTransition] = useTransition();
  const id = useId();

  const submit = () =>
    startTransition(async () => {
      const fd = new FormData();
      fd.set("label", row.label);
      fd.set("startMonth", start);
      fd.set("endMonth", end);
      const res = await callAction(() => setDivisionActiveDuration(fd));
      if (!res.ok) {
        toastFailure(res);
        return;
      }
      toast.success(`${row.label} is the active school year from ${monthLabel(start)} to ${monthLabel(end)}`);
      setOpen(false);
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setStart(row.startMonth ?? `${row.label.slice(0, 4)}-06`);
          setEnd(row.endMonth ?? `${row.label.slice(5, 9)}-04`);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant={row.state === "NOT_SET" ? "default" : "outline"}>
          <CalendarClock className="h-4 w-4" aria-hidden />
          {row.state === "NOT_SET" ? "Set active duration" : "Change duration"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Active duration for {row.label}</DialogTitle>
          <DialogDescription>
            Between these months every school can enroll learners and record ARAL,
            MOSY and BOSY. Outside them, everything is read-only. The last month
            unlocks promotion.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${id}-start`}>Start month</Label>
              <Input
                id={`${id}-start`}
                type="month"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-end`}>End month</Label>
              <Input
                id={`${id}-end`}
                type="month"
                value={end}
                min={start || undefined}
                onChange={(e) => setEnd(e.target.value)}
                required
                disabled={pending}
              />
            </div>
          </div>
          <Callout title={`${row.label} becomes the active year at every school`}>
            Schools without {row.label} get it now. Learners stay in the year they
            are enrolled in until their teacher enrolls them from the promoted
            masterlist.
          </Callout>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} loadingText="Saving…">
              Save duration
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One row per school-year label: its division-wide active duration. */
export function DivisionDurationPanel({ rows }: { rows: DurationRow[] }) {
  return (
    <Surface as="section" className="min-w-0 rounded-lg">
      <SurfaceHeader>
        <div className="min-w-0 space-y-1">
          <h2 className="text-base font-semibold">Active school year</h2>
          <p className="text-sm text-muted-foreground">
            The months when schools can make changes. You set this for the whole division.
          </p>
        </div>
      </SurfaceHeader>
      <SurfaceBody>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Add a school year first.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => {
              const badge = STATE_BADGE[row.state];
              return (
                <li
                  key={row.label}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium tabular-nums">{row.label}</span>
                      <Badge variant={badge.variant}>{badge.text}</Badge>
                      {row.isLastMonth ? <Badge variant="outline">Last month · promotion open</Badge> : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {row.startMonth && row.endMonth
                        ? `${monthLabel(row.startMonth)} – ${monthLabel(row.endMonth)}`
                        : "No active duration yet"}
                      {` · ${row.schools.toLocaleString()} school${row.schools === 1 ? "" : "s"}`}
                    </p>
                  </div>
                  <SetDurationDialog row={row} />
                </li>
              );
            })}
          </ul>
        )}
      </SurfaceBody>
    </Surface>
  );
}
