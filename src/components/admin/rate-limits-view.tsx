"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Gauge, Pencil, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Surface } from "@/components/ui/surface";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import {
  resetAllRateLimits,
  resetRateLimit,
  setRateLimit,
  setRateLimitsPaused,
} from "@/lib/actions/rate-limits";
import { callAction } from "@/lib/ui/call-action";
import { toastFailure } from "@/lib/ui/toast-failure";
import {
  RATE_LIMIT_BOUNDS,
  RATE_LIMIT_SCOPE_LABELS,
  RATE_LIMIT_SCOPE_ORDER,
  formatRateWindow,
  formatRateWindowShort,
  type RateLimitScope,
} from "@/lib/rate-limits/catalog";

export type RateLimitRow = {
  id: string;
  /** What is enforced now: the changed value, or the default. */
  limit: number;
  windowMs: number;
  defaultLimit: number;
  defaultWindowMs: number;
  /** True when this limit was changed on this page. */
  changed: boolean;
  label: string;
  description: string;
  scope: RateLimitScope;
  per: string;
};

function allowance(limit: number, windowMs: number): string {
  return `${limit} per ${formatRateWindow(windowMs)}`;
}

/** Phone value slot: "10 / 5 min", so the limit's name is not cut short. */
function shortAllowance(row: RateLimitRow): string {
  return `${row.limit} / ${formatRateWindowShort(row.windowMs)}`;
}

type RowHandlers = {
  onEdit: (row: RateLimitRow) => void;
  onReset: (row: RateLimitRow) => void;
  resettingId: string | null;
};

function RowActions({ row, onEdit, onReset, resettingId }: { row: RateLimitRow } & RowHandlers) {
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => onEdit(row)}
        aria-label={`Change ${row.label}`}
      >
        <Pencil className="size-4" aria-hidden />
        Change
      </Button>
      {row.changed ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          loading={resettingId === row.id}
          loadingText="Resetting…"
          onClick={() => onReset(row)}
          aria-label={`Reset ${row.label} to default`}
        >
          {resettingId === row.id ? null : <RotateCcw className="size-4" aria-hidden />}
          Reset to default
        </Button>
      ) : null}
    </div>
  );
}

function ChangedNote({ row }: { row: RateLimitRow }) {
  if (!row.changed) return null;
  return (
    <span className="text-xs text-muted-foreground">
      Default: {allowance(row.defaultLimit, row.defaultWindowMs)}
    </span>
  );
}

function ScopeTable({ rows, ...handlers }: { rows: RateLimitRow[] } & RowHandlers) {
  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Limit</TableHead>
          <TableHead>Counted per</TableHead>
          <TableHead numeric>Allowed</TableHead>
          <TableHead className="text-right">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="max-w-[28rem]">
              <p className="font-medium">{row.label}</p>
              <p className="text-sm text-muted-foreground">{row.description}</p>
            </TableCell>
            <TableCell className="text-sm">{row.per}</TableCell>
            <TableCell numeric>
              <span className="flex flex-col items-end gap-1">
                <span>{allowance(row.limit, row.windowMs)}</span>
                {row.changed ? <Badge variant="outline">Changed</Badge> : null}
                <ChangedNote row={row} />
              </span>
            </TableCell>
            <TableCell className="text-right">
              <RowActions row={row} {...handlers} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  const stacked = (
    <StackedList>
      {rows.map((row) => (
        <StackedRow
          key={row.id}
          title={row.label}
          value={shortAllowance(row)}
          state={row.changed ? <Badge variant="outline">Changed</Badge> : undefined}
          meta={`Per ${row.per} · ${allowance(row.limit, row.windowMs)}`}
          details={[
            { label: "What it limits", value: row.description },
            ...(row.changed
              ? [{ label: "Default", value: allowance(row.defaultLimit, row.defaultWindowMs) }]
              : []),
          ]}
          detailActions={<RowActions row={row} {...handlers} />}
        />
      ))}
    </StackedList>
  );

  return <ResponsiveTable table={table} stacked={stacked} breakpoint={900} />;
}

function EditDialog({
  row,
  onClose,
}: {
  row: RateLimitRow | null;
  onClose: () => void;
}) {
  const [saving, startSave] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  if (!row) return null;

  const submit = (formData: FormData) => {
    formData.set("id", row.id);
    startSave(async () => {
      const res = await callAction(() => setRateLimit(formData));
      if (!res.ok) {
        setFieldErrors(res.fieldErrors ?? {});
        toastFailure(res);
        return;
      }
      setFieldErrors({});
      toast.success(`${row.label} saved. It reaches every server within about 10 seconds.`);
      onClose();
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change {row.label}</DialogTitle>
          <DialogDescription>
            {row.description} Default: {allowance(row.defaultLimit, row.defaultWindowMs)}.
          </DialogDescription>
        </DialogHeader>
        <form action={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="rate-limit-limit">Attempts allowed</Label>
              <Input
                id="rate-limit-limit"
                name="limit"
                type="number"
                inputMode="numeric"
                min={RATE_LIMIT_BOUNDS.minLimit}
                max={RATE_LIMIT_BOUNDS.maxLimit}
                step={1}
                required
                defaultValue={row.limit}
                aria-invalid={fieldErrors.limit ? true : undefined}
                aria-describedby={fieldErrors.limit ? "rate-limit-limit-error" : undefined}
              />
              {fieldErrors.limit ? (
                <p id="rate-limit-limit-error" className="text-sm text-destructive">
                  {fieldErrors.limit}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rate-limit-window">Within (minutes)</Label>
              <Input
                id="rate-limit-window"
                name="windowMinutes"
                type="number"
                inputMode="numeric"
                min={RATE_LIMIT_BOUNDS.minWindowMinutes}
                max={RATE_LIMIT_BOUNDS.maxWindowMinutes}
                step={1}
                required
                defaultValue={Math.round(row.windowMs / 60_000)}
                aria-invalid={fieldErrors.windowMinutes ? true : undefined}
                aria-describedby={fieldErrors.windowMinutes ? "rate-limit-window-error" : undefined}
              />
              {fieldErrors.windowMinutes ? (
                <p id="rate-limit-window-error" className="text-sm text-destructive">
                  {fieldErrors.windowMinutes}
                </p>
              ) : null}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            1 to 10,000 attempts, within 1 to 1,440 minutes (one day).
          </p>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} loadingText="Saving…">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Developer Controls → Rate limits: the pause switch, then every limit grouped
 * by what it counts against, same-network limits first. Each limit can be
 * changed, and put back to its default one at a time or all at once.
 */
export function RateLimitsView({
  rows,
  paused,
  codePaused,
}: {
  rows: RateLimitRow[];
  paused: boolean;
  codePaused: boolean;
}) {
  const [saving, startSave] = useTransition();
  const [resettingAll, startResetAll] = useTransition();
  const [, startReset] = useTransition();
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<RateLimitRow | null>(null);
  const off = paused || codePaused;
  const changedCount = rows.filter((r) => r.changed).length;

  const toggle = (next: boolean) => {
    const formData = new FormData();
    formData.set("paused", next ? "true" : "false");
    startSave(async () => {
      const res = await callAction(() => setRateLimitsPaused(formData));
      if (!res.ok) {
        toastFailure(res);
        return;
      }
      toast.success(
        next
          ? "Rate limits paused. Turn them back on as soon as the group is done."
          : "Rate limits are back on."
      );
    });
  };

  const onReset = (row: RateLimitRow) => {
    const formData = new FormData();
    formData.set("id", row.id);
    setResettingId(row.id);
    startReset(async () => {
      const res = await callAction(() => resetRateLimit(formData));
      setResettingId(null);
      if (!res.ok) {
        toastFailure(res);
        return;
      }
      toast.success(`${row.label} is back to ${allowance(row.defaultLimit, row.defaultWindowMs)}.`);
    });
  };

  const onResetAll = () => {
    startResetAll(async () => {
      const res = await callAction(() => resetAllRateLimits());
      if (!res.ok) {
        toastFailure(res);
        return;
      }
      toast.success("Every rate limit is back to its default.");
    });
  };

  const handlers: RowHandlers = { onEdit: setEditing, onReset, resettingId };

  return (
    <div className="space-y-6">
      <Surface
        as="section"
        className={
          off
            ? "min-w-0 space-y-3 rounded-lg border-warning-300 bg-warning-50 p-4 text-warning-950 sm:p-6 dark:border-warning-500/40 dark:bg-warning-950/40 dark:text-warning-100"
            : "min-w-0 space-y-3 rounded-lg p-4 sm:p-6"
        }
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              {off ? (
                <AlertTriangle className="h-5 w-5" aria-hidden />
              ) : (
                <Gauge className="h-5 w-5" aria-hidden />
              )}
              {off ? "All rate limits are paused" : "Rate limits are on"}
            </h2>
            <p className="mt-1 text-sm">
              {off
                ? "Every attempt is allowed, so many people on one network can sign up and sign in at once. Password guessing is not slowed down either. Turn the limits back on as soon as you can."
                : "Pause them only while a large group signs up or signs in from one network, such as a training room on one Wi-Fi. Pausing also removes the protection against password guessing."}
            </p>
            {codePaused ? (
              <p className="mt-2 text-sm font-medium">
                The code-level switch RATE_LIMITS_PAUSED is on, so this page cannot turn the limits
                back on. Set it to false and deploy.
              </p>
            ) : null}
          </div>
          <Badge variant={off ? "outline" : "secondary"}>{off ? "Paused" : "On"}</Badge>
        </div>
        {codePaused ? null : (
          <Button
            type="button"
            variant={paused ? "default" : "outline"}
            loading={saving}
            loadingText="Saving…"
            onClick={() => toggle(!paused)}
          >
            {paused ? "Turn rate limits back on" : "Pause all rate limits"}
          </Button>
        )}
        <p className="text-xs opacity-80">A change reaches every server within about 10 seconds.</p>
      </Surface>

      <Surface as="section" className="min-w-0 space-y-3 rounded-lg p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Changed limits</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {changedCount === 0
                ? "Every limit uses its default."
                : `${changedCount} ${changedCount === 1 ? "limit differs" : "limits differ"} from the default. Raising a sign-in limit makes password guessing easier.`}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={changedCount === 0}
            loading={resettingAll}
            loadingText="Resetting…"
            onClick={onResetAll}
          >
            {resettingAll ? null : <RotateCcw className="size-4" aria-hidden />}
            Reset all to default
          </Button>
        </div>
      </Surface>

      {RATE_LIMIT_SCOPE_ORDER.map((scope) => {
        const scoped = rows.filter((r) => r.scope === scope);
        if (scoped.length === 0) return null;
        return (
          <Surface as="section" key={scope} className="min-w-0 space-y-3 rounded-lg p-4 sm:p-6">
            <h2 className="text-lg font-semibold">{RATE_LIMIT_SCOPE_LABELS[scope]}</h2>
            {scope === "network" ? (
              <p className="text-sm text-muted-foreground">
                Everyone on one Wi-Fi or school network usually shares one IP address, so these
                counters are shared by the whole room.
              </p>
            ) : null}
            <ScopeTable rows={scoped} {...handlers} />
          </Surface>
        );
      })}

      <EditDialog key={editing?.id ?? "none"} row={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
